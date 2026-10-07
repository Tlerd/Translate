# Repository Guidelines

## Project Structure & Module Organization

- `web/`: Next.js App Router application. Routes and API handlers live in `src/app/`; feature controllers and UI in `src/features/`; shared components in `src/components/`; provider integrations in `src/server/`; IndexedDB persistence in `src/storage/`. Static assets are in `public/`, tests in `tests/`, and smoke scripts in `scripts/`.
- `app/`: Flutter Android application. Dart modules live in `lib/`, tests in `test/`, native Kotlin integrations in `android/`, and build/benchmark scripts in `tool/`. Release artifacts and checksums belong in `releases/`.
- Root Markdown files contain Vietnamese setup guides, product plans, and acceptance notes.

## Build, Test, and Development Commands

Run web commands from `web/`:

- `npm ci`: install locked dependencies.
- `npm run dev`: start local development on port 3000.
- `npm run lint` and `npm run typecheck`: check ESLint rules and strict TypeScript types.
- `npm test`: run Vitest tests.
- `npm run build`: validate the production build.
- `npm run test:browser`: run Playwright smoke checks against a running server; the documented setup uses port 3100. Set `BASE_URL` for another port.

Run mobile commands from `app/`:

- `flutter pub get`: install dependencies.
- `dart format lib test` and `flutter analyze`: format and analyze Dart code.
- `flutter test --no-pub --reporter expanded`: run unit and widget tests.
- `flutter run`: launch on a connected device.
- `.\tool\build_release.ps1`: produce release APKs and checksums using the repository's version-code handling.

## Coding Style & Naming Conventions

Use two-space indentation and follow surrounding code. Use kebab-case TypeScript filenames, PascalCase React components, and colocated `*.module.css` styles. Use `@/` imports for web source modules. Dart filenames use snake_case; classes use PascalCase. Web linting uses Next.js ESLint rules; Dart uses `flutter_lints`.

## Testing Guidelines

Name web tests `*.test.ts` and Flutter tests `*_test.dart`. Add regression coverage for changed recording, cancellation, persistence, and provider behavior. No numeric coverage threshold is configured. Mock provider calls for automated checks; report physical-device and real-provider verification separately.

## Commit & Pull Request Guidelines

Follow observed Conventional Commit patterns: `feat(web): ...`, `feat(settings): ...`, or `fix: ...`. Keep commits focused. PRs should describe behavior changes, link relevant issues or plans, list validation commands and results, and include screenshots for UI changes.

## Security & Configuration

Use `web/.env.example` to configure `.env.local`; never commit credentials. Keep web provider keys server-side and mobile keys in secure storage. Preserve single-microphone ownership and final-result draining when changing speech flows.
