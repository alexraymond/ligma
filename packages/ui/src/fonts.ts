// Ligma type stack — all OFL / MIT-compatible.
// Fraunces: editorial serif — body + display in the sketchbook aesthetic
// Kalam: handwriting — margin annotations, plaques, timestamps. Print-style
//        hand chosen over cursive scripts (Caveat, Shadows Into Light) so
//        chip/plaque labels stay legible at 11–16 px.
// JetBrains Mono: monospaced with tabular numerals for metadata + code
// Inter + Geist: dense-UI fallbacks (kept so legacy components don't regress)
import '@fontsource-variable/fraunces';
import '@fontsource-variable/geist';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
// Kalam is only published as a static family (no variable build). Load 400
// (regular) and 700 (bold) so font-weight: 500|600 synthesize cleanly.
import '@fontsource/kalam';
import '@fontsource/kalam/700.css';
