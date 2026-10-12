/** Repair JSON escaping mistakes only inside a known LaTeX field. */
export function normalizeLatex(value: string) {
  let text = value
    .replace(/\u0008(?=(?:oldsymbol|egin|eta|ar|oxed|ig|iggl|iggr)(?![A-Za-z]))/g, '\\b')
    .replace(/\u000c(?=(?:rac|racs|orall)(?![A-Za-z]))/g, '\\f')
    .replace(/\t(?=(?:imes|op|ext|extbf|extit|heta|au|ilde)(?![A-Za-z]))/g, '\\t')
    .replace(/\r(?=(?:ight|m|ho|angle)(?![A-Za-z]))/g, '\\r')
    .replace(/\n(?=(?:abla|eq|e|u|otin)(?![A-Za-z]))/g, '\\n');
  const commands = '(?:boldsymbol|mathbf|mathbb|mathcal|mathsf|mathrm|mathit|operatorname|frac|dfrac|tfrac|sqrt|in|notin|times|top|bot|left|right|begin|end|text|textbf|textit|quad|qquad|tag|sum|prod|int|lim|max|min|sin|cos|tan|log|exp|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|leq?|geq?|neq?|approx|equiv|succeq|preceq|succ|prec|cdot|ldots|cdots|infty|partial|nabla|overline|underline|bar|hat|widehat|tilde|widetilde|dot|ddot|breve|check|vec|overrightarrow|underbrace|overbrace|displaystyle|textstyle)';
  // A TeX command ends before '_' or a digit too; JS word boundaries do not.
  const tail = `(?=${commands}(?![A-Za-z])|[%&#{}])`;
  // If the entire field was JSON-escaped twice, decode its row separators along
  // with commands. Mixed normal/damaged fields keep their genuine TeX \\ rows.
  for (let level=0; level<3; level++) {
    const runs = [...text.matchAll(new RegExp(String.raw`\\+` + tail, 'g'))];
    if (!runs.length || runs.some(m => m[0].length % 2 !== 0)) break;
    text = text.replace(/\\+/g, slashes => slashes.length % 2 === 0 ? '\\'.repeat(slashes.length / 2) : slashes);
  }
  return text.replace(new RegExp(String.raw`\\{2,}(?=${commands}(?![A-Za-z]))`, 'g'), slashes => slashes.length % 2 === 0 ? '\\' : slashes)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim().replace(/^\$\$?\s*|\s*\$\$?$/g, '')
    .replace(/^\\[([]\s*|\s*\\[)\]]$/g, '')
    // KaTeX supports one global tag, positioned absolutely. Multiple tags in
    // aligned fail to render; a single tag can overlap a narrow formula. Keep
    // each number in its own row's normal flow, including in saved responses.
    .replace(/\\tag(\*)?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g,
      (_match, star: string | undefined, number: string) => `\\qquad\\text{${star ? number : `(${number})`}}`);
}
