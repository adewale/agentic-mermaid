# Bundled font licenses (production assets)

The `.ttf` files in this directory ship inside the `agentic-mermaid` npm
package so PNG rasterization (`renderMermaidPNG`) is deterministic and
offline: Inter (weights 400/500/600/700 — the weights the SVG output
requests) is the default face and the family the text-metrics model is
calibrated for; DejaVu Sans serves as the per-glyph fallback for symbols
Inter lacks; and the remaining OFL faces are the typefaces referenced by
the built-in styles (hand-drawn, excalidraw, watercolor → Caveat;
pen-and-ink, tufte → EB Garamond; freehand → Architects Daughter;
blueprint → Share Tech Mono). Custom styles that reference other families
can supply them via the `fontDirs` PNG option.

## OFL-1.1 faces

Each is redistributed unmodified from Google Fonts under the SIL Open Font
License, Version 1.1 (OFL-1.1), whose full text is reproduced below as
required by OFL condition 2.

| File | Typeface | Copyright / Reserved Font Name | Source |
|---|---|---|---|
| `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf` | Inter (v4.001 statics, weights 400/500/600/700) | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) | fonts.google.com/specimen/Inter |
| `Caveat.ttf` | Caveat | Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat) | fonts.google.com/specimen/Caveat |
| `EBGaramond.ttf` | EB Garamond | Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12) | fonts.google.com/specimen/EB+Garamond |
| `ArchitectsDaughter.ttf` | Architects Daughter | Copyright (c) 2010, Kimberly Geswein (kimberlygeswein.com) | fonts.google.com/specimen/Architects+Daughter |
| `ShareTechMono.ttf` | Share Tech Mono | Copyright (c) 2012, Carrois Type Design, Ralph du Carrois, with Reserved Font Name 'Share' | fonts.google.com/specimen/Share+Tech+Mono |

## DejaVu Sans (`DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`)

DejaVu fonts are based on Bitstream Vera fonts. Copyright (c) 2003 Bitstream,
Inc. (Bitstream Vera Fonts license); DejaVu changes are in the public domain.
Redistribution permitted under the Bitstream Vera license terms:
https://dejavu-fonts.github.io/License.html

## SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
