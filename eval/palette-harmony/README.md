# Optional palette harmony experiment

This is an offline `{1,2,3,4}` experiment, not a production render option.
It fits the controlled perceptual palette to the hue-sector templates from
[Cohen-Or et al., *Color Harmonization* (2006)](https://www.cs.tau.ac.il/~dcor/articles/2006/Color-Harmonization.pdf).

The implementation uses the published sector widths and Gaussian contraction,
adapting the paper's HSV hue/saturation objective to OKLCH hue/chroma. It tests
every built-in theme at 7..24 categories, with the production `{1,2,3}` floors
as non-negotiable controls.

```sh
bun run gallery:palette-harmony
bun run gallery:palette-harmony:check
```
