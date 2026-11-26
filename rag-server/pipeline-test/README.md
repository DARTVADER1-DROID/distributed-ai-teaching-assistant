# RAG Validator + Extractor Pipeline Test

This is a small console application for testing the PDF validation and
hierarchical extraction services together.

## Pipeline

1. Read the PDF file into memory.
2. Run ValidatorService::validatePdf.
3. Print every validation issue if the PDF fails validation.
4. Stop before extraction when validation fails.
5. Run ExtractorService::extractPdf when validation passes.
6. Print the extracted document tree with heading levels and page/line
   locations.

The validator and extractor receive the same DocumentFormatConfig values.
The validator-specific page limits retain their defaults.

## Build

The Windows executable is built by the GitHub Actions workflow:

.github/workflows/pipeline-test-windows.yml

Download the rag-pipeline-test-windows-x64 artifact from the successful
workflow run. Extract the entire ZIP folder; keep the DLL files beside the EXE.

## Run on Windows

Open PowerShell or Command Prompt in the extracted folder:

    .\rag_pipeline_test.exe "C:\path\to\your-document.pdf"

Use quotes around the path, especially when it contains spaces.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Validation and extraction both succeeded |
| 1 | Validation failed or extraction failed |
| 2 | Invalid command line or PDF file could not be read |

## Important

- Extraction is deliberately skipped when validation reports any issue.
- A PDF that passes validation may still fail extraction if it contains no
  extractable font information.
- Scanned PDFs are not OCR-processed.
- The printed hierarchy is the current typography-based extraction result,
  not a semantic PDF outline.
