export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  headRevisionId?: string
  size?: string
  /** Display path hint, e.g. the parent folder name. */
  owner?: string
}

/** A file the user chose in the Google Picker (Sekure now has drive.file access to it). */
export interface PickedFile {
  id: string
  name: string
}
