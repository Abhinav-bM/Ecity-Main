#!/usr/bin/env python3
"""
Render a project Markdown document to a styled PDF.

Used to keep docs/*.pdf in step with docs/*.md. Deliberately a small,
dependency-light renderer rather than a toolchain: it handles exactly the
Markdown subset these documents use.

    pip3 install --user reportlab
    python3 scripts/md2pdf.py docs/01-PRD.md docs/01-PRD.pdf "Title" "Subtitle" "meta||lines"
"""
import html
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.doctemplate import NextPageTemplate

ACCENT = colors.HexColor('#1B4965')
ACCENT2 = colors.HexColor('#2C7DA0')
GREY = colors.HexColor('#5B6B76')
RULE = colors.HexColor('#C9D6DE')

# The base-14 PDF fonts have no box-drawing characters, arrows or rupee sign,
# so real TrueType faces are registered instead. Rupee needs a third face:
# neither Arial nor Menlo ships U+20B9.
_SUP = '/System/Library/Fonts/Supplemental/'
try:
    pdfmetrics.registerFont(TTFont('Sans', _SUP + 'Arial.ttf'))
    pdfmetrics.registerFont(TTFont('Sans-Bold', _SUP + 'Arial Bold.ttf'))
    pdfmetrics.registerFont(TTFont('Sans-Italic', _SUP + 'Arial Italic.ttf'))
    pdfmetrics.registerFont(TTFont('Sans-BoldItalic', _SUP + 'Arial Bold Italic.ttf'))
    pdfmetrics.registerFontFamily(
        'Sans', normal='Sans', bold='Sans-Bold', italic='Sans-Italic', boldItalic='Sans-BoldItalic'
    )
    pdfmetrics.registerFont(TTFont('Mono', '/System/Library/Fonts/Menlo.ttc', subfontIndex=0))
    pdfmetrics.registerFont(TTFont('Mono-Bold', '/System/Library/Fonts/Menlo.ttc', subfontIndex=1))
    pdfmetrics.registerFontFamily('Mono', normal='Mono', bold='Mono-Bold')
    pdfmetrics.registerFont(TTFont('Rupee', '/System/Library/Fonts/SFNS.ttf'))
    SANS, SANSB, SANSI, SANSBI, MONO = 'Sans', 'Sans-Bold', 'Sans-Italic', 'Sans-BoldItalic', 'Mono'
    HAS_RUPEE = True
except Exception:  # pragma: no cover - non-macOS fallback
    SANS, SANSB, SANSI, SANSBI, MONO = (
        'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier'
    )
    HAS_RUPEE = False

ss = getSampleStyleSheet()


def S(name, **kw):
    return ParagraphStyle(name, parent=kw.pop('parent', ss['BodyText']), **kw)


BODY = S('body', fontName=SANS, fontSize=9.5, leading=14, spaceAfter=6,
         textColor=colors.HexColor('#1F2A30'))
H1 = S('h1', keepWithNext=1, fontName=SANSB, fontSize=19, leading=24, spaceBefore=6,
       spaceAfter=10, textColor=ACCENT)
H2 = S('h2', keepWithNext=1, fontName=SANSB, fontSize=14, leading=19, spaceBefore=14,
       spaceAfter=7, textColor=ACCENT)
H3 = S('h3', keepWithNext=1, fontName=SANSB, fontSize=11, leading=15, spaceBefore=10,
       spaceAfter=5, textColor=ACCENT2)
H4 = S('h4', keepWithNext=1, fontName=SANSBI, fontSize=9.8, leading=14, spaceBefore=8,
       spaceAfter=4, textColor=colors.HexColor('#33505E'))
LI = S('li', parent=BODY, leftIndent=12, bulletIndent=3, spaceAfter=3, leading=13)
LI2 = S('li2', parent=BODY, leftIndent=26, bulletIndent=16, spaceAfter=2, leading=13, fontSize=9)
CODE = S('code', fontName=MONO, fontSize=7.7, leading=10.4,
         backColor=colors.HexColor('#F4F7F9'), borderPadding=6, leftIndent=4, spaceAfter=8,
         textColor=colors.HexColor('#22333B'))
QUOTE = S('quote', parent=BODY, leftIndent=10, borderPadding=(6, 6, 6, 8),
          backColor=colors.HexColor('#EAF2F6'), textColor=colors.HexColor('#123047'),
          spaceBefore=4, spaceAfter=8)
TH = S('th', fontName=SANSB, fontSize=8.4, leading=11, textColor=colors.white)
TD = S('td', fontName=SANS, fontSize=8.4, leading=11, textColor=colors.HexColor('#1F2A30'))
TITLE = S('title', fontName=SANSB, fontSize=27, leading=33, textColor=ACCENT, spaceAfter=8)
SUBT = S('subt', fontName=SANS, fontSize=12.5, leading=18, textColor=GREY, spaceAfter=4)


def _fixspan(x):
    x = x.replace(' ', '&nbsp;')
    return x.replace('₹', '<font name="Rupee">₹</font>') if HAS_RUPEE else x.replace('₹', 'Rs.')


def inline(t):
    """Markdown inline markup -> ReportLab mini-HTML."""
    t = html.escape(t, quote=False)
    spans = []

    def stash(m):
        spans.append(m.group(1))
        return '\x00%d\x00' % (len(spans) - 1)

    # Code spans are protected so the dash/arrow substitutions below cannot
    # mangle a command such as `--typescript`.
    t = re.sub(r'`([^`]+)`', stash, t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<i>\1</i>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<link href="\2" color="#0F5C7A"><u>\1</u></link>', t)
    t = t.replace('->', '→').replace('--', '–')
    if HAS_RUPEE:
        t = t.replace('₹', '<font name="Rupee">₹</font>')
    else:
        t = t.replace('₹', 'Rs.')
    return re.sub(
        r'\x00(\d+)\x00',
        lambda m: '<font face="Mono" size="8.6" color="#0F5C7A">%s</font>'
        % _fixspan(spans[int(m.group(1))]),
        t,
    )


def build_table(rows, avail):
    """Column widths from real text metrics, so no column collapses to a sliver."""
    ncol = max(len(r) for r in rows)
    rows = [(r + [''] * ncol)[:ncol] for r in rows]
    header, body = rows[0], rows[1:]
    PAD = 13.0

    def w(txt, bold=False):
        return pdfmetrics.stringWidth(re.sub(r'[`*]', '', txt), SANSB if bold else SANS, 8.4)

    minw, maxw = [], []
    for c in range(ncol):
        col = [(header[c], True)] + [(r[c], False) for r in body]
        longest_word = max([w(word, b) for t, b in col for word in (t.split() or [''])] or [0])
        full = max([w(t, b) for t, b in col] or [0])
        minw.append(min(longest_word + PAD, avail * 0.34))
        maxw.append(min(max(full + PAD, longest_word + PAD), avail * 0.62))

    if sum(maxw) <= avail:
        extra, tot = avail - sum(maxw), sum(maxw) or 1
        widths = [x + extra * x / tot for x in maxw]
    elif sum(minw) < avail:
        room = avail - sum(minw)
        span = [maxw[c] - minw[c] for c in range(ncol)]
        tot = sum(span) or 1
        widths = [minw[c] + room * span[c] / tot for c in range(ncol)]
    else:
        k = avail / sum(minw)
        widths = [x * k for x in minw]

    data = [[Paragraph(inline(c), TH) for c in header]]
    data += [[Paragraph(inline(c), TD) for c in r] for r in body]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), ACCENT),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#F6F9FB')))
    t.setStyle(TableStyle(style))
    return t


def parse(md, avail):
    flow, para = [], []
    lines = md.split('\n')
    i, n = 0, len(lines)

    def flush():
        nonlocal para
        if para:
            flow.append(Paragraph(inline(' '.join(para)), BODY))
            para = []

    while i < n:
        ln, s = lines[i], lines[i].strip()

        if s.startswith('```'):
            flush()
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            txt = html.escape('\n'.join(buf)).replace(' ', '&nbsp;').replace('\n', '<br/>')
            if HAS_RUPEE:
                txt = txt.replace('₹', '<font name="Rupee">₹</font>')
            flow.append(Paragraph(txt, CODE))
            continue

        if s.startswith('|') and i + 1 < n and re.match(r'^\|[\s:|-]+\|$', lines[i + 1].strip()):
            flush()
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                r = lines[i].strip()
                if not re.match(r'^\|[\s:|-]+\|$', r):
                    rows.append([c.strip() for c in r.strip('|').split('|')])
                i += 1
            flow.append(build_table(rows, avail))
            flow.append(Spacer(1, 7))
            continue

        if not s:
            flush()
            i += 1
            continue

        m = re.match(r'^(#{1,4})\s+(.*)$', s)
        if m:
            flush()
            lvl = len(m.group(1))
            flow.append(Paragraph(inline(m.group(2)), [H1, H2, H3, H4][lvl - 1]))
            if lvl == 2:
                rule = Table([['']], colWidths=[avail], rowHeights=[1.6],
                             style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), RULE)]))
                rule.keepWithNext = 1
                sp = Spacer(1, 6)
                sp.keepWithNext = 1
                flow += [rule, sp]
            i += 1
            continue

        if s in ('---', '***', '___'):
            flush()
            flow.append(Spacer(1, 4))
            flow.append(Table([['']], colWidths=[avail], rowHeights=[0.7],
                              style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), RULE)])))
            flow.append(Spacer(1, 8))
            i += 1
            continue

        if s.startswith('> '):
            flush()
            buf = []
            while i < n and lines[i].strip().startswith('> '):
                buf.append(lines[i].strip()[2:])
                i += 1
            flow.append(Paragraph(inline(' '.join(buf)), QUOTE))
            continue

        m = re.match(r'^(\s*)([-*+]|\d+[.)])\s+(.*)$', ln)
        if m:
            flush()
            indent, mark, txt = len(m.group(1)), m.group(2), m.group(3)
            style = LI2 if indent >= 2 else LI
            bullet = mark if mark[0].isdigit() else ('▪' if indent >= 2 else '•')
            j = i + 1
            while (j < n and lines[j].strip()
                   and not re.match(r'^\s*([-*+]|\d+[.)])\s+', lines[j])
                   and not lines[j].strip().startswith(('#', '|', '>', '```'))):
                txt += ' ' + lines[j].strip()
                j += 1
            flow.append(Paragraph(inline(txt), style, bulletText=bullet))
            i = j
            continue

        para.append(s)
        i += 1

    flush()
    return flow


def render(md_path, pdf_path, title, subtitle, meta_lines):
    md = re.sub(r'^#\s+.*\n', '', open(md_path).read(), count=1)  # H1 goes on the cover
    doc = BaseDocTemplate(pdf_path, pagesize=A4, leftMargin=19 * mm, rightMargin=17 * mm,
                          topMargin=20 * mm, bottomMargin=18 * mm, title=title, author='ECITY')
    avail = doc.width

    def decorate(canv, d):
        canv.saveState()
        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.5)
        canv.line(d.leftMargin, A4[1] - 14 * mm, d.leftMargin + d.width, A4[1] - 14 * mm)
        canv.setFont(SANS, 7.5)
        canv.setFillColor(GREY)
        canv.drawString(d.leftMargin, A4[1] - 12 * mm, title)
        canv.drawRightString(d.leftMargin + d.width, A4[1] - 12 * mm,
                             'ECITY — Mobile Shop Management')
        canv.line(d.leftMargin, 13 * mm, d.leftMargin + d.width, 13 * mm)
        canv.drawString(d.leftMargin, 9.5 * mm, subtitle)
        canv.drawRightString(d.leftMargin + d.width, 9.5 * mm, 'Page %d' % canv.getPageNumber())
        canv.restoreState()

    def cover(canv, _d):
        canv.saveState()
        canv.setFillColor(ACCENT)
        canv.rect(0, A4[1] - 16 * mm, A4[0], 16 * mm, stroke=0, fill=1)
        canv.setFillColor(ACCENT2)
        canv.rect(0, 0, A4[0], 7 * mm, stroke=0, fill=1)
        canv.restoreState()

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='n')
    doc.addPageTemplates([PageTemplate(id='cover', frames=[frame], onPage=cover),
                          PageTemplate(id='main', frames=[frame], onPage=decorate)])

    flow = [NextPageTemplate('main'), Spacer(1, 46 * mm), Paragraph(title, TITLE),
            Paragraph(subtitle, SUBT), Spacer(1, 8),
            Table([['']], colWidths=[62 * mm], rowHeights=[2.4],
                  style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), ACCENT2)])),
            Spacer(1, 12)]
    for line in meta_lines:
        flow.append(Paragraph(inline(line),
                              S('m', fontName=SANS, fontSize=9.5, leading=15, textColor=GREY)))
    flow.append(PageBreak())
    flow += parse(md, avail)
    doc.build(flow)
    print('wrote', pdf_path)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5].split('||'))
