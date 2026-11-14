// The State name grammar both State parsers, the comment scan and the writer
// read. Pinned Mermaid's State lexer reads a name as `[^:\n\s\-\{]+`
// (stateDiagram.jison): any run of characters but a colon, a blank, a hyphen
// or `{`, so `ContainerRuntime.process`, `a/b` and `x(y)` are names. Ours
// reads those names, and a hyphen inside one, as before. It leaves out the
// characters that are syntax of its own: `;` and `}` end a statement, `"`
// quotes a label, `[` and `]` spell `[*]` and history endpoints, `<` and `>`
// a stereotype or an arrow (`a->b`), and `,` separates the names a class or
// style statement lists. A name does not start with `#`, which starts a
// comment in Mermaid, or with `//`, which starts a line ours reads as a
// comment, and holds no control character.

/** One character of a name, other than a hyphen. */
const NAME_CHARACTER = String.raw`[^\s:;,{}\[\]"<>\p{Cc}-]`

/** A whole state name; a hyphen may appear anywhere in it. Needs the `u` flag. */
export const STATE_NAME_SOURCE = String.raw`(?!#|//)(?:${NAME_CHARACTER}|-)+`

/** A name where a statement starts: it starts with a character other than a
 *  hyphen, and a hyphen continues it unless it starts an arrow (`A-->B`).
 *  Needs the `u` flag. */
export const STATE_STATEMENT_NAME_SOURCE = String.raw`(?!#|//)${NAME_CHARACTER}(?:${NAME_CHARACTER}|-(?!->))*`

/** The names a `style` statement lists, separated by commas. Needs the `u` flag. */
export const STATE_NAME_LIST_SOURCE = String.raw`(?!#|//)(?:${NAME_CHARACTER}|[-,])+`
