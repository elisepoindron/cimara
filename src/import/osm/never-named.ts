/**
 * The one name this repository never carries: the private archive the code was
 * first written for, whose brand is not ours to use. Some OpenStreetMap features
 * link to it; the extract drops those tags and the translator refuses to carry
 * any value that still names it. The hooks in .githooks/ and CI refuse a commit,
 * a message or a tree that holds it (scripts/guard/check.ts).
 *
 * Kept ROT13-encoded, so that the one place that has to know the name does not
 * spell it: a search of the tree for it finds nothing, this file included.
 */
const SEALED = 'thyyvire'

export const PRIVATE_NAME = SEALED.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97))

export const NEVER_NAMED = new RegExp(PRIVATE_NAME, 'i')
