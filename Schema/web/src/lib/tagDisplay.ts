import type { Tag } from './uiState';

export function getTagDisplayName(tag: Pick<Tag, 'name' | 'displayName' | 'parentName'>): string {
  if (tag.displayName) return tag.displayName;
  if (tag.parentName) return `${tag.parentName}：${tag.name}`;
  return tag.name;
}

export function sortTagsForPicker(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => (
    getTagDisplayName(a).localeCompare(getTagDisplayName(b), 'zh-CN')
  ));
}

export function groupTagsByParent(tags: Tag[]) {
  const roots = tags.filter((tag) => !tag.parentId);
  const childrenByParent = new Map<number, Tag[]>();
  for (const tag of tags) {
    if (!tag.parentId) continue;
    const list = childrenByParent.get(tag.parentId) || [];
    list.push(tag);
    childrenByParent.set(tag.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  roots.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { roots, childrenByParent };
}
