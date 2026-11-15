const legacyNames = {
  'Coen van der Geest': { firstName: 'Coen', namePrefix: 'van der', lastName: 'Geest' },
  'Kim Zegers': { firstName: 'Kim', namePrefix: '', lastName: 'Zegers' },
  'Martijn Konijn': { firstName: 'Martijn', namePrefix: '', lastName: 'Konijn' },
}

export function legacyNameMigration(profile) {
  return !Object.hasOwn(profile, 'firstName') && Object.hasOwn(legacyNames, profile.name)
    ? { ...legacyNames[profile.name] }
    : null
}

export function profileNameParts(profile = {}) {
  if (Object.hasOwn(profile, 'firstName')) {
    const { firstName, namePrefix = '', lastName = '' } = profile
    return { firstName, namePrefix, lastName }
  }
  const migrated = legacyNameMigration(profile)
  if (migrated) return migrated
  const [firstName = '', ...surname] = (profile.name ?? '').trim().split(/\s+/)
  return { firstName, namePrefix: '', lastName: surname.join(' ') }
}

export function fullProfileName(profile) {
  if (!Object.hasOwn(profile, 'firstName')) return profile.name ?? ''
  const { firstName, namePrefix, lastName } = profileNameParts(profile)
  return [firstName, namePrefix, lastName].filter(Boolean).join(' ')
}
