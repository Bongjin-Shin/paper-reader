use crate::db::{db_error, Database};
use rusqlite::{params_from_iter, types::Value, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const VOCABULARY: &[&str] = &["vocabulary_entries", "vocabulary_contexts", "highlights"];
pub const HIGHLIGHTS: &[&str] = &["highlights"];
pub const LIBRARY: &[&str] = &[
    "papers",
    "library_folders",
    "library_papers",
    "pending_pdf_deletions",
];
const LIMIT: usize = 50;

#[derive(Default)]
pub struct History {
    undo: VecDeque<Entry>,
    redo: Vec<Entry>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub undo: Option<String>,
    pub redo: Option<String>,
}
struct Entry {
    label: String,
    tables: Vec<TableChange>,
}
struct TableChange {
    name: String,
    columns: Vec<String>,
    rows: Vec<RowChange>,
}
struct RowChange {
    before: Option<Vec<Value>>,
    after: Option<Vec<Value>>,
}
struct Snapshot {
    name: String,
    columns: Vec<String>,
    rows: BTreeMap<String, Vec<Value>>,
}

fn snapshot(db: &Connection, tables: &[&str]) -> Result<Vec<Snapshot>, String> {
    tables
        .iter()
        .map(|table| {
            if !VOCABULARY.contains(table) && !LIBRARY.contains(table) {
                return Err("실행 취소 대상이 올바르지 않습니다.".into());
            }
            let mut statement = db
                .prepare(&format!("SELECT * FROM {table}"))
                .map_err(db_error)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let rows = statement
                .query_map([], |r| {
                    (0..columns.len())
                        .map(|i| r.get::<_, Value>(i))
                        .collect::<Result<Vec<_>, _>>()
                })
                .map_err(db_error)?
                .map(|r| r.map(|row| (format!("{:?}", row[0]), row)))
                .collect::<Result<BTreeMap<_, _>, _>>()
                .map_err(db_error)?;
            Ok(Snapshot {
                name: (*table).into(),
                columns,
                rows,
            })
        })
        .collect()
}
fn changes(before: Vec<Snapshot>, after: Vec<Snapshot>) -> Vec<TableChange> {
    before
        .into_iter()
        .zip(after)
        .filter_map(|(before, after)| {
            let keys = before
                .rows
                .keys()
                .chain(after.rows.keys())
                .collect::<BTreeSet<_>>();
            let rows = keys
                .into_iter()
                .filter_map(|key| {
                    let b = before.rows.get(key);
                    let a = after.rows.get(key);
                    (b != a).then(|| RowChange {
                        before: b.cloned(),
                        after: a.cloned(),
                    })
                })
                .collect::<Vec<_>>();
            (!rows.is_empty()).then_some(TableChange {
                name: before.name,
                columns: before.columns,
                rows,
            })
        })
        .collect()
}
fn rollback(db: &Connection) {
    let _ = db.execute_batch("ROLLBACK TO app_history; RELEASE app_history;");
}

impl History {
    pub(crate) fn reserved_ids(&self) -> [i64; 3] {
        let mut ids = [0; 3];
        for table in self
            .undo
            .iter()
            .chain(self.redo.iter())
            .flat_map(|entry| &entry.tables)
        {
            if let Some(index) = VOCABULARY.iter().position(|name| *name == table.name) {
                for row in &table.rows {
                    if let Some(Value::Integer(id)) = row
                        .before
                        .as_ref()
                        .or(row.after.as_ref())
                        .and_then(|row| row.first())
                    {
                        ids[index] = ids[index].max(*id);
                    }
                }
            }
        }
        ids
    }
}

impl Database {
    /// Capture only changed rows, under the caller's DB lock. API charges/settings are excluded.
    pub fn record<T>(
        &mut self,
        label: &str,
        tables: &[&str],
        action: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        self.connection
            .execute_batch("SAVEPOINT app_history;")
            .map_err(db_error)?;
        let result = (|| {
            let before = snapshot(&self.connection, tables)?;
            let value = action(self)?;
            let after = snapshot(&self.connection, tables)?;
            let tables = changes(before, after);
            self.connection
                .execute_batch("RELEASE app_history;")
                .map_err(db_error)?;
            Ok((value, tables))
        })();
        match result {
            Ok((value, tables)) => {
                if !tables.is_empty() {
                    self.history.redo.clear();
                    self.history.undo.push_back(Entry {
                        label: label.into(),
                        tables,
                    });
                    while self.history.undo.len() > LIMIT {
                        self.history.undo.pop_front();
                    }
                }
                Ok(value)
            }
            Err(error) => {
                rollback(&self.connection);
                Err(error)
            }
        }
    }
    pub fn history_state(&self) -> HistoryState {
        HistoryState {
            undo: self.history.undo.back().map(|entry| entry.label.clone()),
            redo: self.history.redo.last().map(|entry| entry.label.clone()),
        }
    }
    pub fn clear_redo(&mut self) {
        self.history.redo.clear();
    }
    /// Deleted copies remain available while either history stack could restore them.
    pub fn history_papers(&self) -> BTreeSet<String> {
        self.history
            .undo
            .iter()
            .chain(self.history.redo.iter())
            .flat_map(|entry| &entry.tables)
            .filter(|table| table.name == "library_papers")
            .flat_map(|table| &table.rows)
            .filter_map(
                |row| match row.before.as_ref().or(row.after.as_ref())?.first()? {
                    Value::Text(id) => Some(id.clone()),
                    _ => None,
                },
            )
            .collect()
    }
    pub fn restore_history(
        &mut self,
        redo: bool,
        papers_dir: &std::path::Path,
    ) -> Result<Option<String>, String> {
        let entry = if redo {
            self.history.redo.last()
        } else {
            self.history.undo.back()
        };
        let Some(entry) = entry else {
            return Ok(None);
        };
        self.connection
            .execute_batch("SAVEPOINT app_history; PRAGMA defer_foreign_keys = ON;")
            .map_err(db_error)?;
        let result = apply(&self.connection, entry, redo, papers_dir).and_then(|()| {
            let bad: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
                    [],
                    |r| r.get(0),
                )
                .map_err(db_error)?;
            if bad {
                return Err("연결된 데이터가 변경되어 실행 취소할 수 없습니다.".into());
            }
            self.connection
                .execute_batch("RELEASE app_history;")
                .map_err(db_error)
        });
        if let Err(error) = result {
            rollback(&self.connection);
            return Err(error);
        }
        let entry = if redo {
            self.history.redo.pop().unwrap()
        } else {
            self.history.undo.pop_back().unwrap()
        };
        let label = entry.label.clone();
        if redo {
            self.history.undo.push_back(entry);
        } else {
            self.history.redo.push(entry);
        }
        Ok(Some(label))
    }
}

fn pair(row: &RowChange, redo: bool) -> (&Option<Vec<Value>>, &Option<Vec<Value>>) {
    if redo {
        (&row.before, &row.after)
    } else {
        (&row.after, &row.before)
    }
}
fn apply(
    db: &Connection,
    entry: &Entry,
    redo: bool,
    papers_dir: &std::path::Path,
) -> Result<(), String> {
    // Validate every row before writing. Updates compare only fields this action changed,
    // preserving unrelated later lookups, timestamps and automatically extracted metadata.
    for table in &entry.tables {
        for row in &table.rows {
            let (from, to) = pair(row, redo);
            let key = &from.as_ref().or(to.as_ref()).unwrap()[0];
            let current = db
                .query_row(
                    &format!(
                        "SELECT * FROM {} WHERE {} = ?1",
                        table.name, table.columns[0]
                    ),
                    [key],
                    |r| {
                        (0..table.columns.len())
                            .map(|i| r.get::<_, Value>(i))
                            .collect::<Result<Vec<_>, _>>()
                    },
                )
                .optional()
                .map_err(db_error)?;
            let matches = match (from, to, &current) {
                (Some(from), Some(to), Some(current)) => from
                    .iter()
                    .zip(to)
                    .zip(current)
                    .all(|((a, b), c)| a == b || a == c),
                _ => from == &current,
            };
            if !matches {
                return Err("해당 데이터가 이후에 변경되어 실행 취소/다시 실행할 수 없습니다. 현재 데이터는 유지됩니다.".into());
            }
            if table.name == "library_papers" && from.is_none() && to.is_some() {
                if let Value::Text(id) = key {
                    if id.len() != 64
                        || !id.bytes().all(|c| c.is_ascii_hexdigit())
                        || !papers_dir.join(format!("{id}.pdf")).is_file()
                    {
                        return Err(
                            "복원할 PDF 사본을 찾지 못했습니다. 현재 데이터는 유지됩니다.".into(),
                        );
                    }
                }
            }
        }
    }
    // Foreign keys are deferred until the complete group is restored.
    for table in entry.tables.iter().rev() {
        for row in &table.rows {
            let (from, to) = pair(row, redo);
            if let (Some(from), None) = (from, to) {
                db.execute(
                    &format!("DELETE FROM {} WHERE {} = ?1", table.name, table.columns[0]),
                    [&from[0]],
                )
                .map_err(db_error)?;
            }
        }
    }
    for table in &entry.tables {
        for row in &table.rows {
            let (from, to) = pair(row, redo);
            match (from, to) {
                (None, Some(to)) => {
                    let placeholders = vec!["?"; to.len()].join(",");
                    db.execute(
                        &format!(
                            "INSERT INTO {} ({}) VALUES ({placeholders})",
                            table.name,
                            table.columns.join(",")
                        ),
                        params_from_iter(to),
                    )
                    .map_err(db_error)?;
                }
                (Some(from), Some(to)) => {
                    let changed = from
                        .iter()
                        .zip(to)
                        .enumerate()
                        .filter_map(|(i, (a, b))| (a != b).then_some(i))
                        .collect::<Vec<_>>();
                    let columns = changed
                        .iter()
                        .map(|&i| format!("{} = ?", table.columns[i]))
                        .collect::<Vec<_>>()
                        .join(",");
                    let values = changed
                        .iter()
                        .map(|&i| &to[i])
                        .chain(std::iter::once(&to[0]));
                    db.execute(
                        &format!(
                            "UPDATE {} SET {columns} WHERE {} = ?",
                            table.name, table.columns[0]
                        ),
                        params_from_iter(values),
                    )
                    .map_err(db_error)?;
                }
                _ => {}
            }
        }
    }
    Ok(())
}
