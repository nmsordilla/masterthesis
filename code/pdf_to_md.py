"""Turn a PDF (e.g. a trial protocol or SAP) into Markdown, so only text is sent to the API.

Sending a PDF itself costs its text plus an image of every page, which for a 300-page protocol
is several hundred thousand input tokens. The Markdown keeps the headings, lists and tables,
at a fraction of that.

Each conversion is saved to code/extracted/<name>_<hash>.md (gitignored) and reused the next
time the same PDF is attached, so you can open the file and read exactly what the model got.

    python code/pdf_to_md.py path/to/protocol.pdf   # convert and print where it was saved

Needs: pip install pymupdf4llm
"""

import hashlib
import sys
from pathlib import Path

EXTRACTED_DIR = Path(__file__).parent / "extracted"

# Fewer characters than this per page on average means the PDF is probably scanned images
# without a text layer, which this conversion cannot read.
MIN_CHARS_PER_PAGE = 50


def pdf_to_markdown(filename: str, data: bytes) -> tuple[str, Path]:
    """Markdown text of a PDF and the file it was saved to. Reuses an earlier conversion."""
    digest = hashlib.sha256(data).hexdigest()
    out = EXTRACTED_DIR / f"{Path(filename).stem}_{digest[:12]}.md"
    if out.exists():
        return out.read_text(encoding="utf-8"), out

    try:
        import pymupdf
        import pymupdf4llm
    except ImportError as e:
        raise RuntimeError("Reading PDFs needs pymupdf4llm: pip install pymupdf4llm") from e

    with pymupdf.open(stream=data, filetype="pdf") as doc:
        pages = doc.page_count
        markdown = pymupdf4llm.to_markdown(doc, show_progress=False)

    if len(markdown.strip()) < MIN_CHARS_PER_PAGE * max(pages, 1):
        raise ValueError(
            f"{filename}: almost no text found in {pages} pages. It is probably a scanned PDF without a "
            "text layer; run it through OCR first (e.g. 'Make searchable' in Acrobat), then attach it again."
        )

    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown, encoding="utf-8")
    return markdown, out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python code/pdf_to_md.py path/to/file.pdf")
    pdf = Path(sys.argv[1])
    text, path = pdf_to_markdown(pdf.name, pdf.read_bytes())
    print(f"{len(text):,} characters (about {len(text) // 4:,} tokens) saved to {path}")
