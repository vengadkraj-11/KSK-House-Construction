// TypeScript and non-platform tooling use the native default implementation;
// Expo resolves firebase.web.ts for browser bundles and firebase.native.ts on Android.
export * from './firebase.native';
