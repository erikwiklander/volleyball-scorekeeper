import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const env = {
  ...process.env,
  VITE_FIREBASE_CONFIG: JSON.stringify({
    apiKey: 'demo-key',
    projectId: 'demo-volleyball-scorekeeper',
    authDomain: 'demo-volleyball-scorekeeper.firebaseapp.com',
    appId: 'demo-app',
    databaseURL:
      'https://demo-volleyball-scorekeeper-default-rtdb.firebaseio.com',
  }),
  VITE_FIREBASE_EMULATORS: 'true',
  VITE_LIVE_BASE_URL: '',
};
for (const path of [
  '/opt/homebrew/opt/openjdk@21',
  '/usr/local/opt/openjdk@21',
])
  if (existsSync(path + '/bin/java')) {
    env.PATH = path + '/bin:' + env.PATH;
    env.JAVA_HOME = path + '/libexec/openjdk.jdk';
    break;
  }
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('node_modules/.bin/vite', ['build', '--outDir', 'dist-live']);
run('node_modules/.bin/firebase', [
  'emulators:exec',
  '--project',
  'demo-volleyball-scorekeeper',
  '--only',
  'auth,database',
  'npm run test:rules && npm run test:live:browser',
]);
