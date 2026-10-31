"""
compressor.py — Document size-fitting utility for government portal uploads.

Public API (called by Member 1's browser agent, same Python process):

    from app.compressor import prepare_for_upload
    result = prepare_for_upload(file_path, max_bytes, allowed_types)

    result.fits        → True if the file fits the portal's limit
    result.final_path  → attach this path to the portal form
    result.message     → show this sentence to the citizen

Rules:
- The ORIGINAL file is NEVER modified.
- Everything stays in memory or in backend/uploads/ (no disk leaks outside it).
- No network calls. No logging of document content or OCR text.
- Never crash — every exception is caught and returned as fits=False.
"""

from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

import pymupdf  # PyMuPDF

try:
    from app.schemas import PreparedFile
except ImportError:
    from backend.app.schemas import PreparedFile

# ---------------------------------------------------------------------------
# Directory anchor — all output files stay inside here
# ---------------------------------------------------------------------------
_UPLOADS_DIR = (Path(__file__).resolve().parent.parent / "uploads").resolve()
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Quality floor constants (never go below these)
# ---------------------------------------------------------------------------
_MIN_JPEG_QUALITY = 45
_MIN_LONGER_SIDE_PX = 1000
_MIN_PDF_RENDER_DPI = 100
_GS_PRESETS = ["/printer", "/ebook", "/screen"]  # from least to most aggressive

# PDF compression ladder (dpi, jpeg_quality) pairs — stop at first fit
_PDF_RENDER_STEPS = [
    (150, 75),
    (120, 65),
    (_MIN_PDF_RENDER_DPI, _MIN_JPEG_QUALITY),
]

# Image compression ladder
_JPEG_QUALITIES = [85, 75, 65, 55, _MIN_JPEG_QUALITY]
_RESIZE_FACTORS = [0.90, 0.75, 0.60]  # as fraction of current dimensions


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_path(file_path: str) -> Optional[Path]:
    """
    Resolve and validate that file_path is inside _UPLOADS_DIR.
    Returns the resolved Path, or None if the path escapes the folder.
    Blocks symlinks that point outside the folder.
    """
    p = Path(file_path).resolve()
    # Reject symlinks that escape uploads/
    if p.is_symlink():
        real = Path(os.path.realpath(p))
        if not str(real).startswith(str(_UPLOADS_DIR)):
            return None
    try:
        p.relative_to(_UPLOADS_DIR)
    except ValueError:
        return None
    return p


def _tmp_path(suffix: str) -> Path:
    """Return a unique path inside _UPLOADS_DIR for a temporary/output file."""
    return _UPLOADS_DIR / f"{uuid.uuid4().hex}_prepared{suffix}"


def _fmt(n: int) -> str:
    """Human-readable byte count, e.g. 2.4 MB."""
    if n >= 1_048_576:
        return f"{n / 1_048_576:.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n} B"


def _is_signed_pdf(doc: pymupdf.Document) -> bool:
    """Heuristic: check for signature fields in any page's widget list."""
    try:
        for page in doc:
            for widget in page.widgets() or []:
                if widget.field_type_string in ("Sig", "Signature"):
                    return True
    except Exception:
        pass
    return False


def _ext_allowed(path: Path, allowed_types: Optional[list[str]]) -> bool:
    """True when the file's extension matches allowed_types (case-insensitive)."""
    if allowed_types is None:
        return True
    ext = path.suffix.lstrip(".").lower()
    return ext in [t.lower().lstrip(".") for t in allowed_types]


def _allowed_image_ext(allowed_types: Optional[list[str]]) -> Optional[str]:
    """
    Return the first image extension from allowed_types that we can produce,
    preferring jpeg over png (smaller). Returns None if no image type allowed.
    """
    if allowed_types is None:
        return "jpg"
    for t in ["jpg", "jpeg", "png"]:
        if t in [x.lower().lstrip(".") for x in allowed_types]:
            return t
    return None


def _pdf_allowed(allowed_types: Optional[list[str]]) -> bool:
    if allowed_types is None:
        return True
    return "pdf" in [t.lower().lstrip(".") for t in allowed_types]


# ---------------------------------------------------------------------------
# Readability check (optional — skipped silently if Tesseract absent)
# ---------------------------------------------------------------------------

def _word_set(text: str) -> set[str]:
    return set(re.findall(r"[A-Za-z0-9]{3,}", text))


def _ocr_first_page_words(path: Path) -> Optional[set[str]]:
    """Return alphanumeric word set from the first page via Tesseract, or None."""
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore

        ext = path.suffix.lower()
        if ext == ".pdf":
            doc = pymupdf.open(str(path))
            pix = doc[0].get_pixmap(dpi=150)
            doc.close()
            img = Image.open(io.BytesIO(pix.tobytes("png")))
        else:
            img = Image.open(str(path))
        text = pytesseract.image_to_string(img, lang="eng")
        return _word_set(text)
    except Exception:
        return None


def _readability_ok(original_path: Path, result_path: Path, threshold: float = 0.70) -> bool:
    """
    Return True if the result has at least `threshold` of the original's words.
    Returns True (safe default) when Tesseract is unavailable.
    """
    orig_words = _ocr_first_page_words(original_path)
    if orig_words is None or len(orig_words) == 0:
        return True  # can't check — assume OK
    result_words = _ocr_first_page_words(result_path)
    if result_words is None:
        return True
    overlap = len(orig_words & result_words) / len(orig_words)
    return overlap >= threshold


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------

def _image_to_pdf(src: Path) -> Optional[Path]:
    """Convert an image file to a single-page PDF using PyMuPDF."""
    try:
        out = _tmp_path(".pdf")
        doc = pymupdf.open()
        img_doc = pymupdf.open(str(src))
        pdfbytes = img_doc.convert_to_pdf()
        img_doc.close()
        pdf = pymupdf.open("pdf", pdfbytes)
        pdf.save(str(out), garbage=4, deflate=True)
        pdf.close()
        return out
    except Exception:
        return None


def _pdf_first_page_to_image(src: Path, ext: str) -> Optional[Path]:
    """Render first page of a PDF to JPG or PNG using PyMuPDF."""
    try:
        from PIL import Image  # type: ignore
        out = _tmp_path(f".{ext}")
        doc = pymupdf.open(str(src))
        pix = doc[0].get_pixmap(dpi=200)
        doc.close()
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        if ext in ("jpg", "jpeg"):
            img = img.convert("RGB")
            img.save(str(out), "JPEG", quality=85)
        else:
            img.save(str(out), "PNG")
        return out
    except Exception:
        return None


# ---------------------------------------------------------------------------
# PDF compression steps
# ---------------------------------------------------------------------------

def _pymupdf_cleanup(src: Path) -> Optional[Path]:
    """Step PDF-a: garbage collect + deflate + clean internal PDF structure."""
    try:
        out = _tmp_path(".pdf")
        doc = pymupdf.open(str(src))
        doc.save(str(out), garbage=4, deflate=True, clean=True)
        doc.close()
        return out
    except Exception:
        return None


def _pymupdf_render(src: Path, dpi: int, quality: int) -> Optional[Path]:
    """
    Step PDF-b: render each page as JPEG and rebuild as PDF.
    Caps at 20 pages; returns None on any error.
    """
    try:
        from PIL import Image  # type: ignore
        out = _tmp_path(".pdf")
        doc = pymupdf.open(str(src))
        new_doc = pymupdf.open()
        page_count = len(doc)

        for i, page in enumerate(doc):
            if i >= 20:
                break
            pix = page.get_pixmap(dpi=dpi)
            # Convert to JPEG bytes via Pillow
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            jpeg_buf = io.BytesIO()
            img.save(jpeg_buf, "JPEG", quality=quality, optimize=True)
            jpeg_buf.seek(0)
            # Insert as a new PDF page of the same dimensions
            w_pt = page.rect.width   # original page width in points
            h_pt = page.rect.height
            new_page = new_doc.new_page(width=w_pt, height=h_pt)
            new_page.insert_image(new_page.rect, stream=jpeg_buf.read())

        doc.close()
        new_doc.save(str(out), garbage=4, deflate=True)
        new_doc.close()
        return out
    except Exception:
        return None


def _ghostscript_compress(src: Path, preset: str, timeout: int = 60) -> Optional[Path]:
    """
    Step PDF-c: run Ghostscript with the given preset.
    Returns None if gs is not installed, fails, or times out.
    Raises nothing.
    """
    gs = shutil.which("gs")
    if not gs:
        return None  # caller adds the warning

    out = _tmp_path(".pdf")
    cmd = [
        gs,
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        f"-dPDFSETTINGS={preset}",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-sOutputFile={out}",
        str(src),
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            # shell=False is the default — explicit for clarity
        )
        if result.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return out
        out.unlink(missing_ok=True)
        return None
    except (subprocess.TimeoutExpired, OSError, Exception):
        out.unlink(missing_ok=True)
        return None


# ---------------------------------------------------------------------------
# Image compression steps
# ---------------------------------------------------------------------------

def _compress_image(src: Path, max_bytes: int, allowed_types: Optional[list[str]]) -> tuple[Optional[Path], str]:
    """
    Try quality reduction then resize reduction until size fits.
    Returns (output_path, method_label) or (None, "floor_reached").
    """
    try:
        from PIL import Image, ImageOps  # type: ignore

        img = Image.open(str(src))
        img = ImageOps.exif_transpose(img)  # fix phone rotation

        # Determine output format
        target_ext = _allowed_image_ext(allowed_types)
        use_jpeg = target_ext in ("jpg", "jpeg")
        suffix = f".{target_ext}" if target_ext else src.suffix

        if use_jpeg:
            img = img.convert("RGB")

        # ---- Quality ladder
        for q in _JPEG_QUALITIES:
            out = _tmp_path(suffix)
            if use_jpeg:
                img.save(str(out), "JPEG", quality=q, optimize=True)
            else:
                # PNG: quantise to reduce size
                img.save(str(out), "PNG", optimize=True)
            if out.stat().st_size <= max_bytes:
                return out, f"pillow_quality_{q}"
            out.unlink(missing_ok=True)

        # ---- Resize ladder (starting from original image size)
        for factor in _RESIZE_FACTORS:
            w, h = img.size
            new_w = max(int(w * factor), 1)
            new_h = max(int(h * factor), 1)
            # Floor: never below 1000px on longer side
            longer = max(new_w, new_h)
            if longer < _MIN_LONGER_SIDE_PX:
                break
            resized = img.resize((new_w, new_h), Image.LANCZOS)
            out = _tmp_path(suffix)
            if use_jpeg:
                resized.save(str(out), "JPEG", quality=_MIN_JPEG_QUALITY, optimize=True)
            else:
                resized.save(str(out), "PNG", optimize=True)
            if out.stat().st_size <= max_bytes:
                pct = int(factor * 100)
                return out, f"pillow_resize_{pct}pct_q{_MIN_JPEG_QUALITY}"
            out.unlink(missing_ok=True)

        return None, "floor_reached"
    except Exception:
        return None, "error"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def prepare_for_upload(
    file_path: str,
    max_bytes: int,
    allowed_types: Optional[list[str]] = None,
) -> PreparedFile:
    """
    Fit a document inside `max_bytes` for a government portal upload field.

    Parameters
    ----------
    file_path     : absolute path inside backend/uploads/ (from extract or agent).
    max_bytes     : portal's stated maximum file size in bytes.
    allowed_types : list of allowed extensions without dot, e.g. ["pdf"] or
                    ["jpg","jpeg","png"]. None means any type is accepted.

    Returns
    -------
    PreparedFile  — see schemas.PreparedFile for all fields.
                    Never raises; on any failure returns fits=False + message.
    """
    warnings: list[str] = []
    intermediates: list[Path] = []  # temp files to clean up on exit

    def _fail(msg: str) -> PreparedFile:
        """Clean up intermediates and return a fits=False result."""
        for p in intermediates:
            p.unlink(missing_ok=True)
        orig_size = src.stat().st_size if src and src.exists() else 0
        return PreparedFile(
            final_path=file_path,
            original_bytes=orig_size,
            final_bytes=orig_size,
            compressed=False,
            converted=False,
            method_used="none",
            fits=False,
            warnings=warnings,
            message=msg,
        )

    src: Optional[Path] = None

    try:
        # ------------------------------------------------------------------ #
        # 1. Input validation                                                 #
        # ------------------------------------------------------------------ #
        src = _safe_path(file_path)
        if src is None:
            return PreparedFile(
                final_path=file_path, original_bytes=0, final_bytes=0,
                compressed=False, converted=False, method_used="none",
                fits=False, warnings=[],
                message=f"Rejected: path '{file_path}' is outside the uploads folder or uses a symlink escape.",
            )
        if not src.exists():
            return PreparedFile(
                final_path=file_path, original_bytes=0, final_bytes=0,
                compressed=False, converted=False, method_used="none",
                fits=False, warnings=[],
                message=f"Rejected: file not found at '{file_path}'.",
            )

        allowed_native = {".pdf", ".png", ".jpg", ".jpeg"}
        if src.suffix.lower() not in allowed_native:
            return PreparedFile(
                final_path=file_path, original_bytes=0, final_bytes=0,
                compressed=False, converted=False, method_used="none",
                fits=False, warnings=[],
                message=f"Rejected: unsupported file type '{src.suffix}'. Accepted: PDF, PNG, JPG, JPEG.",
            )

        original_bytes = src.stat().st_size
        is_pdf = src.suffix.lower() == ".pdf"
        converted = False
        working = src  # file we're currently working with

        # ------------------------------------------------------------------ #
        # 2. Type conversion (if needed)                                      #
        # ------------------------------------------------------------------ #
        if not _ext_allowed(working, allowed_types):
            if is_pdf and _allowed_image_ext(allowed_types):
                # PDF → image (first page only)
                img_ext = _allowed_image_ext(allowed_types)
                out = _pdf_first_page_to_image(working, img_ext)
                if out is None:
                    return _fail("Could not convert PDF to image. Please convert manually.")
                intermediates.append(out)
                working = out
                converted = True
                is_pdf = False
            elif not is_pdf and _pdf_allowed(allowed_types):
                # image → PDF
                out = _image_to_pdf(working)
                if out is None:
                    return _fail("Could not convert image to PDF. Please convert manually.")
                intermediates.append(out)
                working = out
                converted = True
                is_pdf = True
            elif not is_pdf and _allowed_image_ext(allowed_types):
                # image → different image format (e.g. PNG → JPEG)
                # We don't move working yet; _compress_image will produce the right format.
                # Just mark converted=True; the actual format change happens in the ladder.
                converted = True
            else:
                types_str = ", ".join(allowed_types) if allowed_types else "any"
                return _fail(
                    f"File type '{src.suffix.lstrip('.')}' is not allowed "
                    f"(portal accepts: {types_str}) and no automatic conversion is possible."
                )

        # ------------------------------------------------------------------ #
        # 2b. Signed-PDF warning                                              #
        # ------------------------------------------------------------------ #
        if is_pdf and working.stat().st_size > max_bytes:
            try:
                doc = pymupdf.open(str(working))
                signed = _is_signed_pdf(doc)
                doc.close()
                if signed:
                    warnings.append(
                        "This PDF may be digitally signed; "
                        "compression can invalidate the signature."
                    )
            except Exception:
                pass

        # ------------------------------------------------------------------ #
        # 3. Already fits? (possibly after format conversion)                 #
        # ------------------------------------------------------------------ #
        current_size = working.stat().st_size

        # For image→image conversion (e.g. PNG→JPEG), we only set converted=True
        # above without producing the output yet. Do the conversion now.
        if converted and not is_pdf and working == src:
            img_ext = _allowed_image_ext(allowed_types) or src.suffix.lstrip(".")
            out = _tmp_path(f".{img_ext}")
            try:
                from PIL import Image, ImageOps  # type: ignore
                img = Image.open(str(src))
                img = ImageOps.exif_transpose(img)
                if img_ext in ("jpg", "jpeg"):
                    img.convert("RGB").save(str(out), "JPEG", quality=85, optimize=True)
                else:
                    img.save(str(out), "PNG", optimize=True)
                intermediates.append(out)
                working = out
                current_size = out.stat().st_size
            except Exception:
                out.unlink(missing_ok=True)
                return _fail("Could not convert image format. Please convert manually.")

        if current_size <= max_bytes:
            # Keep the final file (remove from cleanup list so it is not deleted)
            if working != src:
                intermediates = [p for p in intermediates if p != working]
            return PreparedFile(
                final_path=str(working),
                original_bytes=original_bytes,
                final_bytes=current_size,
                compressed=False,
                converted=converted,
                method_used="none",
                fits=True,
                warnings=warnings,
                message=(
                    f"Your file is {_fmt(current_size)}, which fits the {_fmt(max_bytes)} limit."
                    + (" (type was converted)" if converted else "")
                ),
            )

        # ------------------------------------------------------------------ #
        # 4. Compression ladder                                               #
        # ------------------------------------------------------------------ #
        best: Optional[Path] = None   # last candidate that fits
        best_method = "none"
        method_used = "none"
        ladder_files: list[Path] = []  # all candidates produced (to clean later)

        # Keep track of the previous-step path for readability fallback
        prev_fit: Optional[Path] = None
        prev_method = "none"

        if is_pdf:
            # ---- PDF-a: PyMuPDF cleanup
            step = _pymupdf_cleanup(working)
            if step:
                ladder_files.append(step)
                if step.stat().st_size <= max_bytes:
                    best, best_method = step, "pymupdf"
                else:
                    # ---- PDF-b: render at descending dpi
                    page_count = pymupdf.open(str(working)).page_count
                    if page_count > 20:
                        warnings.append(
                            f"PDF has {page_count} pages; only the first 20 were processed."
                        )
                    for dpi, quality in _PDF_RENDER_STEPS:
                        if best:
                            break
                        candidate = _pymupdf_render(working, dpi, quality)
                        if candidate:
                            ladder_files.append(candidate)
                            if candidate.stat().st_size <= max_bytes:
                                best = candidate
                                best_method = f"pymupdf_render_{dpi}dpi_q{quality}"

            if not best:
                # ---- PDF-c: Ghostscript
                gs_available = bool(shutil.which("gs"))
                if not gs_available:
                    warnings.append(
                        "Ghostscript not installed; install with: "
                        "brew install ghostscript  (macOS) or "
                        "apt-get install -y ghostscript  (Linux/Docker)"
                    )
                else:
                    for preset in _GS_PRESETS:
                        if best:
                            break
                        candidate = _ghostscript_compress(working, preset)
                        if candidate:
                            ladder_files.append(candidate)
                            if candidate.stat().st_size <= max_bytes:
                                best = candidate
                                best_method = f"ghostscript:{preset}"

        else:
            # ---- Image ladder
            candidate, label = _compress_image(working, max_bytes, allowed_types)
            if candidate:
                ladder_files.append(candidate)
                best = candidate
                best_method = label

        # ------------------------------------------------------------------ #
        # 5. Quality floor / unachievable                                     #
        # ------------------------------------------------------------------ #
        if best is None:
            # Clean everything in ladder_files + intermediates
            for p in ladder_files + intermediates:
                p.unlink(missing_ok=True)
            return PreparedFile(
                final_path=str(working if working != src else src),
                original_bytes=original_bytes,
                final_bytes=working.stat().st_size,
                compressed=False,
                converted=converted,
                method_used="none",
                fits=False,
                warnings=warnings,
                message=(
                    f"Could not reduce the file below {_fmt(max_bytes)} without making the document "
                    f"unreadable (quality floor reached). Please upload a smaller version manually."
                ),
            )

        # ------------------------------------------------------------------ #
        # 6. Readability check on winning candidate                           #
        # ------------------------------------------------------------------ #
        if not _readability_ok(src, best):
            warnings.append(
                "Compressed copy may be hard to read; some text may be illegible."
            )

        # ------------------------------------------------------------------ #
        # 7. Clean up intermediates that are NOT the final answer             #
        # ------------------------------------------------------------------ #
        final_path = best
        for p in ladder_files + intermediates:
            if p != final_path:
                p.unlink(missing_ok=True)

        final_size = final_path.stat().st_size
        return PreparedFile(
            final_path=str(final_path),
            original_bytes=original_bytes,
            final_bytes=final_size,
            compressed=True,
            converted=converted,
            method_used=best_method,
            fits=True,
            warnings=warnings,
            message=(
                f"Your file was reduced from {_fmt(original_bytes)} to "
                f"{_fmt(final_size)} using {best_method}."
            ),
        )

    except Exception as exc:
        # Last-resort catch — never crash the caller
        for p in intermediates:
            p.unlink(missing_ok=True)
        orig = src.stat().st_size if (src and src.exists()) else 0
        return PreparedFile(
            final_path=file_path,
            original_bytes=orig,
            final_bytes=orig,
            compressed=False,
            converted=False,
            method_used="none",
            fits=False,
            warnings=warnings + [f"Internal error: {type(exc).__name__}"],
            message=f"An unexpected error occurred while preparing the file: {exc}",
        )
