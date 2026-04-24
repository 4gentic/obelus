#set page(paper: "us-letter")

= Broken typst fixture

Hello #fo — the identifier `fo` is not defined anywhere in this document, so
`typst compile` exits non-zero with `error: unknown variable: fo`.

The fix-compile skill should propose replacing `#fo` with a compilable
placeholder (`#emph[(compile error: unknown variable 'fo')]`).
