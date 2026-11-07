/**
 * Folder names Drive for desktop uses for the two containers inside an
 * account. The list is evidence, not a contract: an unrecognized name keeps
 * being shown literally, and nothing is hidden when it does not match.
 */
const MY_DRIVE_NAMES = ['my drive', 'meu drive', 'o meu disco', 'mi unidad', 'mon drive', 'mein drive', 'il mio drive', 'マイドライブ', '我的云端硬盘', '내 드라이브'];
const SHARED_DRIVES_NAMES = ['shared drives', 'drives compartilhados', 'discos partilhados', 'unidades compartilhadas', 'lecteurs partagés', 'geteilte laufwerke', 'unità condivise', '共有ドライブ', '共享云端硬盘', '공유 드라이브'];

export interface DriveFolderGroup {
  id: 'my-drive' | 'shared-drives';
  label: string;
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase(); }

/** The recognized group for a folder name, or undefined when the name is unknown. */
export function groupForFolderName(name: string): DriveFolderGroup | undefined {
  const value = normalize(name);
  if (MY_DRIVE_NAMES.includes(value)) return { id: 'my-drive', label: 'My Drive' };
  if (SHARED_DRIVES_NAMES.includes(value)) return { id: 'shared-drives', label: 'Shared drives' };
  return undefined;
}

/** The account folder prefix used by the macOS File Provider mount name. */
export const CLOUD_STORAGE_ACCOUNT_PREFIX = 'GoogleDrive-';

/** The account label carried by a File Provider folder name, when it has one. */
export function accountFromCloudStorageName(name: string): string | undefined {
  return name.startsWith(CLOUD_STORAGE_ACCOUNT_PREFIX) && name.length > CLOUD_STORAGE_ACCOUNT_PREFIX.length
    ? name.slice(CLOUD_STORAGE_ACCOUNT_PREFIX.length)
    : undefined;
}
