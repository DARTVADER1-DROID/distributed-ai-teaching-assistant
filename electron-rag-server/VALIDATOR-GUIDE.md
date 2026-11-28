# PDF Validator Authoring Guide

This document describes the PDF input contract implemented by the Electron RAG server's validation pipeline. It is intended for anyone authoring PDFs for course ingestion and for building deterministic validator test fixtures.

The validator analyzes text and font sizes extracted by PDF.js. It does **not** read literal labels such as `H1:` or infer heading levels from Markdown syntax. Heading levels are inferred from configured font sizes.

## 1. Default document limits and typography

The defaults are defined in `config/config.ts`.

| Element | Required/default font size |
| --- | ---: |
| H1 | 24.0 pt |
| H2 | 20.0 pt |
| H3 | 18.0 pt |
| H4 | 16.0 pt |
| H5 | 14.0 pt |
| H6 | 12.0 pt |
| Body / paragraph | Dominant extracted font size; use 10.0 pt for predictable fixtures |

Default tolerances:

- Heading font-size match: **±0.5 pt** from the configured H1-H6 size.
- Body-vs-heading distinction: a line is a heading candidate only when it contains a font size greater than the detected body size plus **0.5 pt**.
- Paragraph font-size deviation: **±0.5 pt** from the detected body-font baseline.
- Font-size normalization precision: **2 decimal places**.

The body-font baseline is calculated from the most frequent extracted text-item font size, not from the number of words or characters. Use one consistent body size throughout the PDF. Do not introduce unrelated font sizes for captions, headers, footers, page numbers, or decorative text: non-body text above the body threshold must match a configured heading size or it can be rejected as an unsupported font size.

Page limits default to a minimum of **1 page** and no maximum (`maximum_pages = 0`). If a maximum is configured, it must be zero or greater than or equal to the minimum.

## 2. How a heading is recognized

A line is classified as a heading based on its extracted font size:

1. The line must contain a font size greater than `body_font_size + body_font_size_tolerance_points`.
2. That font size must be within the configured heading-size tolerance of one of H1-H6.
3. If a line contains multiple font sizes, the largest recognized heading-sized font determines its heading level.
4. The validator does not require or interpret textual prefixes such as `H1:`, `H2:`, or Markdown hashes. Use the actual heading text, formatted at the correct font size.

Keep each heading on **one extracted text line**. A wrapped heading may be extracted as multiple lines and interpreted as multiple heading starts. Keep headings concise enough to fit within the page's text width.

## 3. Explicit heading closure is mandatory

Every opened heading must be explicitly closed. The exact closure text is:

```text
End of topic.
```

The closure marker must be formatted at the **same configured font size as the heading level it closes**. The marker is itself detected as a heading-level line by font size; a body-sized 10 pt marker is not recognized as a heading closure.

Examples with the default sizes:

| Heading being closed | Exact marker text | Marker font size |
| --- | --- | ---: |
| H1 | `End of topic.` | 24.0 pt |
| H2 | `End of topic.` | 20.0 pt |
| H3 | `End of topic.` | 18.0 pt |
| H4 | `End of topic.` | 16.0 pt |
| H5 | `End of topic.` | 14.0 pt |
| H6 | `End of topic.` | 12.0 pt |

The marker must occupy its own extracted line. After trimming leading and trailing whitespace, its complete text must equal `End of topic.`; do not append explanations, punctuation, numbering, or other text to that line.

## 4. Hierarchy and closure order

The validator maintains a stack of active headings. A child heading remains nested under its active parent until the child is explicitly closed.

### 4.1 Descend one level at a time

A new child heading may descend by **exactly one level** from the currently active heading:

- H1 → H2 is valid.
- H2 → H3 is valid.
- H3 → H4 is valid.
- H1 → H3 is invalid because it skips H2.
- H2 → H4 is invalid because it skips H3.

The first detected heading is accepted as the initial active heading; the validator does not independently require that the first heading be H1.

### 4.2 Close a child before opening its sibling

A heading at the same level cannot begin while the previous heading at that level is still active.

Correct sibling pattern:

```text
[H2 heading text, formatted at 20 pt]
[H2 content]
[H3 first subsection, formatted at 18 pt]
[H3 content]
End of topic.       (18 pt: closes the H3 subsection)
[H3 second subsection, formatted at 18 pt]
[H3 content]
End of topic.       (18 pt: closes the second H3 subsection)
End of topic.       (20 pt: closes the H2 parent)
```

Do not open the second H3 before closing the first H3.

### 4.3 Close descendants before their parent

When moving upward in the hierarchy, close every active descendant in reverse order before closing its parent.

For example, when H1 → H2 → H3 is open, the required closure order is:

1. H3 marker at 18 pt.
2. H2 marker at 20 pt.
3. H1 marker at 24 pt.

Only after the required closures may a new H1 or another heading at the now-valid level begin.

### 4.4 Close every heading before the document ends

The document must end with an empty active-heading stack. Close the deepest active heading first, then each parent, until all headings are closed. A heading left open at end-of-file is a validation error even if all of its content appears complete.

## 5. Page boundaries do not close headings

The hierarchy traversal continues across pages. A page break does not close, reset, or otherwise change the active heading stack.

This permits a topic to continue across a page boundary:

- Page 1: open H2, write some body content, then end the page without an H2 closure marker.
- Page 2: continue the H2 content, optionally open and close child headings, then close the H2 when its topic is complete.

Do not insert a closure marker merely because a page ends. Insert it only when the logical topic represented by that heading has ended.

## 6. Complete authoring checklist

Before submitting a PDF for ingestion, verify:

- [ ] The PDF contains at least the configured minimum number of pages.
- [ ] Body paragraphs use one consistent body font size.
- [ ] Heading sizes match the configured H1-H6 sizes within ±0.5 pt.
- [ ] No decorative, footer, caption, or page-number text introduces unsupported font sizes above the body threshold.
- [ ] Each heading fits on one extracted text line.
- [ ] The first heading is a sensible root for the intended hierarchy (normally H1, even though the validator does not enforce H1 as the first level).
- [ ] Every descent is exactly one heading level.
- [ ] Every sibling heading is preceded by a closure marker for the previous heading at that level.
- [ ] Every parent is closed only after all descendants have been closed.
- [ ] Each `End of topic.` marker is on its own line and uses the same font size as the heading it closes.
- [ ] All open headings are closed before the document ends.
- [ ] Page breaks are used only for layout and are not treated as topic closures.

## 7. Interpreting common validation errors

| Validator message | Meaning | Correction |
| --- | --- | --- |
| `Heading H3 starts while H3 is still open` | The previous H3 was not closed before another H3 began. | Add an H3-sized `End of topic.` line before the next H3. |
| `Heading H2 starts while H3 is still open` | An H3 child remains active when a parent-level or sibling H2 begins. | Close the H3 first; then close any other open descendants and the H2 parent as required. |
| `Invalid heading closure at H2 ... active heading is H3` | A parent is being closed while a child remains active. | Close the H3 before the H2. |
| `Invalid heading level transition from H1 to H3` | The hierarchy skipped a level. | Insert the missing H2 parent or change the intended level. |
| `Heading Hn was not explicitly closed` | The heading remains active at end-of-file. | Add the matching Hn-sized closure marker before the document ends. |
| `Detected non-body text ... does not match any configured heading size` | A non-body font size is outside all configured heading tolerances. | Use body size or one configured heading size; remove unsupported decorative font sizes. |
| `Paragraph text uses ...` | Paragraph text differs from the detected body baseline beyond tolerance. | Use the same body font size consistently. |

## 8. Scope and validation stages

The validation service runs page-limit validation and font-size validation. Heading hierarchy traversal runs when the font-size validator reports valid configuration.

The hierarchy validator uses extracted lines in document order, including page number and line number. It recognizes headings and closure markers through font sizes and exact line text, respectively. It does not validate the technical correctness of the PDF's subject matter, semantic completeness, visual aesthetics, or whether a heading title accurately describes its content.

For deterministic test fixtures, use plain selectable text, explicit font sizes, one heading per line, one closure marker per line, and simple page layouts. Always submit the generated fixture to the actual ingestion validation endpoint; a PDF library's successful file generation or text extraction alone does not prove that it passes this validator.
