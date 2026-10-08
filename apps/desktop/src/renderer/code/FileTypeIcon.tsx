import type { IconProps } from '@phosphor-icons/react';
import { FileIcon } from '@phosphor-icons/react/dist/csr/File';

/** 新增文件入口沿用本地文件图标，不按扩展名改换外观。 */
export function FileTypeIcon({ name, ...props }: IconProps & { name: string }) {
  void name;
  return <FileIcon size={16} weight="regular" aria-hidden="true" {...props} />;
}
