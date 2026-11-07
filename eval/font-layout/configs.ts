export const variants = [
  { id: 'shipped-off', features: [] }, { id: 'fonts', features: ['fonts'] },
  { id: 'elk-order', features: ['elk-order'] }, { id: 'ports', features: ['ports'] },
  { id: 'wrap', features: ['wrap'] }, { id: 'all', features: ['fonts', 'elk-order', 'ports', 'wrap'] },
  { id: 'all-minus-fonts', features: ['elk-order', 'ports', 'wrap'] },
  { id: 'all-minus-order', features: ['fonts', 'ports', 'wrap'] },
  { id: 'all-minus-ports', features: ['fonts', 'elk-order', 'wrap'] },
  { id: 'all-minus-wrap', features: ['fonts', 'elk-order', 'ports'] },
]
