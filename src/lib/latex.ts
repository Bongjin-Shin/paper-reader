/** Repair common JSON escaping mistakes only inside a known LaTeX field.
 * Preserve real TeX row separators (\\) and whitespace in aligned/cases. */
export function normalizeLatex(value: string) {
  return value
    .replace(/\u0008(?=(?:oldsymbol|egin|eta|ar|oxed|ig|iggl|iggr)\b)/g, '\\b')
    .replace(/\u000c(?=(?:rac|racs|orall)\b)/g, '\\f')
    .replace(/\t(?=(?:imes|op|ext|extbf|extit|heta|au|ilde)\b)/g, '\\t')
    .replace(/\r(?=(?:ight|m|ho|angle)\b)/g, '\\r')
    .replace(/\n(?=(?:abla|eq|e|u|otin)\b)/g, '\\n')
    .replace(/\\{2,}(?=(?:boldsymbol|mathbf|mathbb|mathcal|mathsf|mathrm|mathit|operatorname|frac|dfrac|tfrac|sqrt|in|notin|times|top|bot|left|right|begin|end|text|textbf|textit|quad|qquad|sum|prod|int|lim|max|min|sin|cos|tan|log|exp|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|leq?|geq?|neq?|approx|equiv|cdot|ldots|cdots|infty|partial|nabla|overline|underline|hat|tilde|vec|overrightarrow|underbrace|overbrace)\b|[%&#])/g, slashes => slashes.length % 2 === 0 ? '\\' : slashes)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim().replace(/^\$\$?\s*|\s*\$\$?$/g, '')
    .replace(/^\\[([]\s*|\s*\\[)\]]$/g, '');
}
