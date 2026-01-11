# k VS Code extension

Basic syntax highlighting for the k language.

## Install (local)

- Open this folder in VS Code.
- Press F5 to run the extension in the Extension Development Host.

## Build a VSIX and install manually

- From this folder, run `npx vsce package` (or `vsce package` if installed globally). This invokes the VSCE packaging tool and produces `k-<version>.vsix` in the current directory.
- In VS Code, open Extensions → “Install from VSIX…” and select the generated file to install the extension locally.

## Notes

- Language id: `k`
- File extension: `.k`
