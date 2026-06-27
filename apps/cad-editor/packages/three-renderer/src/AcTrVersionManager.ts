const VERSION = '1.0.0'

const versionKey = 'VERSION'

/**
 * Gets the sdk version ran on this device from local storage.
 */
const getVersionFromLocalStorage = () => {
  return window.localStorage.getItem(versionKey)
}

/**
 * Sets the sdk version to local storage.
 */
const setVersionToLocalStorage = () => {
  window.localStorage.setItem(versionKey, VERSION)
}

/**
 * Checks if current sdk version and last version are different.
 * There can be storage data formant change if sdk version is updated,
 * we may simply clean up local storage in this case.
 */
const checkIsNewVersion = () => {
  const lastVersion = getVersionFromLocalStorage()
  if (lastVersion !== VERSION) {
    setVersionToLocalStorage()
    return true
  }
  return false
}

const AcTrVersionManager = {
  getVersionFromLocalStorage: getVersionFromLocalStorage,
  setVersionToLocalStorage: setVersionToLocalStorage,
  checkIsNewVersion: checkIsNewVersion
}

export {
  getVersionFromLocalStorage,
  setVersionToLocalStorage,
  checkIsNewVersion,
  AcTrVersionManager
}
