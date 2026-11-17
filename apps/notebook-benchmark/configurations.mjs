/** What each named configuration analyses. Everything not listed is what Setdown does.
 *
 * level         checking level; the product's notebook settings for that level are used
 * product       false: the bundled analyzer alone, with cells as written and no bundled stubs
 * settings      analyzer settings laid over the product's, by their pyrightconfig.json names
 * withoutStubs  bundled stub libraries to leave out, by the folder names of stubs.json
 * stubs         candidate stub packages to add: the folder name the analyzer should see,
 *               mapped to a path from the repository root
 * summaryOnly   a saved baseline keeps the counts but not every diagnostic */
export const configurations = {
  off: { level: 'off' },
  basic: { level: 'basic' },
  standard: { level: 'standard' },
  strict: { level: 'strict', summaryOnly: true },
  // What the notebook rules and the bundled stubs change, measured against the analyzer alone.
  analyzer: { level: 'basic', product: false },
  // Only types that a library or its stubs declare; nothing inferred from library source.
  declared: { level: 'basic', settings: { useLibraryCodeForTypes: false } },
  // One bundled library's contribution, and a candidate that is not bundled.
  'basic-without-sklearn-stubs': { level: 'basic', withoutStubs: ['sklearn'] },
  'basic-with-sympy-stubs': { level: 'basic', stubs: { 'sympy-stubs': 'vendor/python-type-stubs/stubs/sympy-stubs' } },
};

/** Analysed when `run` names none. */
export const standard = ['off', 'basic', 'standard', 'strict', 'analyzer'];
