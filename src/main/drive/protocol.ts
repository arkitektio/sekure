export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  headRevisionId?: string
  size?: string
  /** Display path hint, e.g. the parent folder name. */
  owner?: string
}
