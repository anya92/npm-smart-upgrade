# NPM Smart Upgrade

NPM Smart Upgrade is a VS Code extension that scans your workspace for npm dependency updates, groups them by update type (major/minor/patch), and lets you analyze breaking changes and apply upgrades directly from the sidebar.

## What It Does
- Scans `package.json` (and optionally `devDependencies`) for available updates.
- Uses `package-lock.json` to determine the currently installed version.
- Groups updates into Major, Minor, and Patch lists.
- Lets you analyze breaking changes per package (manual, on-demand).
- Offers optional automatic patch updates.
- Can generate migration suggestions via GitHub Copilot when breaking changes are found.

## Requirements
- VS Code `^1.85.0`
- Node.js + npm
- GitHub sign-in (for breaking change analysis)
- Copilot CLI with `--headless` support for analysis
  - `brew upgrade copilot-cli`
  - `npm i -g @github/copilot`

## Run Locally (Extension Development)
1. Install dependencies: `npm install`
2. Compile the extension: `npm run compile`
3. Open the project in VS Code and press `F5` to launch the Extension Host.

## Configuration
Settings live under `npmSmartUpgrade`:
- `npmSmartUpgrade.scanInterval` (number, minutes)  
  Interval between scans. Default: `30`.
- `npmSmartUpgrade.includeDevDependencies` (boolean)  
  Include `devDependencies` in the scan. Default: `true`.
- `npmSmartUpgrade.autoUpdatePatch` (boolean)  
  Automatically run `npm install` for patch updates. Default: `false`.
- `npmSmartUpgrade.enableCopilot` (boolean)  
  Enables Copilot-backed breaking change analysis (set on login). Default: `false`.

## Usage Flow
1. **Open the view**  
   Click the **NPM Smart Upgrade** activity bar icon to open the sidebar.
2. **Review updates**  
   Packages are grouped into Major/Minor/Patch lists.
3. **Login for analysis (optional)**  
   Use **Login with GitHub (+Copilot)** in the sidebar to enable breaking change analysis.
4. **Analyze a package**  
   Right-click a package (or use the inline action) and choose **Analyze Breaking Changes**.
5. **View details**  
   Click a package to open details (current version, latest version, analysis results).
6. **Update a package**  
   Use **Update Package** to run `npm install <pkg>`.
7. **Update + resolve**  
   Use **Update & Resolve Breaking Changes** to generate Copilot migration suggestions, preview diffs, and apply changes.

## Notes
- Breaking change analysis is **manual** and per-package.
- If the Copilot CLI is missing or outdated, the sidebar shows a banner with update instructions.
