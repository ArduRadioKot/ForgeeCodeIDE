const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, pickAsset, installPlan, describeRelease, isAllowedUrl } = require('../lib/updater');

const assets = [
  { name: 'FrogeeCodeIDE-2.5.0-arm64.dmg' },
  { name: 'FrogeeCodeIDE-2.5.0-x64.dmg' },
  { name: 'FrogeeCodeIDE Setup 2.5.0.exe' },
  { name: 'FrogeeCodeIDE-2.5.0.AppImage' },
  { name: 'FrogeeCodeIDE-2.5.0.deb' },
];

test('compares release versions numerically', () => {
  assert.equal(compareVersions('v2.5.0', '2.4.9'), 1);
  assert.equal(compareVersions('2.5.0', 'v2.5.0'), 0);
  assert.equal(compareVersions('2.9.0', '2.10.0'), -1);
});

test('selects a compatible release asset', () => {
  assert.equal(pickAsset(assets, { platform: 'darwin', arch: 'arm64' }).name, 'FrogeeCodeIDE-2.5.0-arm64.dmg');
  assert.equal(pickAsset(assets, { platform: 'darwin', arch: 'x64' }).name, 'FrogeeCodeIDE-2.5.0-x64.dmg');
  assert.equal(pickAsset(assets, { platform: 'win32', arch: 'x64' }).name, 'FrogeeCodeIDE Setup 2.5.0.exe');
  assert.equal(pickAsset(assets, { platform: 'linux', arch: 'x64' }).name, 'FrogeeCodeIDE-2.5.0.AppImage');
  assert.equal(pickAsset([assets[0]], { platform: 'darwin', arch: 'x64' }), null);
});

test('chooses an install route supported by the current package', () => {
  assert.equal(installPlan({ platform: 'darwin' }, assets[0]), 'mac');
  assert.equal(installPlan({ platform: 'win32' }, assets[2]), 'windows');
  assert.equal(installPlan({ platform: 'linux', appImage: true }, assets[3]), 'appimage');
  assert.equal(installPlan({ platform: 'linux', appImage: false }, assets[4]), 'manual');
});

test('describes a newer release and uses the expected repository page', () => {
  const release = { tag_name: 'v2.5.0', body: 'Исправления', html_url: 'https://github.com/ArduRadioKot/ForgeeCodeIDE/releases/tag/v2.5.0', assets };
  const info = describeRelease(release, '2.4.0', { platform: 'darwin', arch: 'arm64' });
  assert.equal(info.available, true);
  assert.equal(info.latest, '2.5.0');
  assert.equal(info.asset.name, assets[0].name);
  assert.equal(describeRelease(release, '2.5.0', { platform: 'darwin', arch: 'arm64' }).available, false);
});

test('accepts only HTTPS GitHub download hosts', () => {
  assert.equal(isAllowedUrl('https://api.github.com/repos/ArduRadioKot/ForgeeCodeIDE/releases/latest'), true);
  assert.equal(isAllowedUrl('https://release-assets.githubusercontent.com/file'), true);
  assert.equal(isAllowedUrl('http://github.com/file'), false);
  assert.equal(isAllowedUrl('https://github.com.evil.example/file'), false);
});
