/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See VSCODE-LICENSE in this directory.
 * Adapted from VS Code d3d31f62268b169a2dfab62ffb2d7d38158a5b7c; see NOTICE.
 *--------------------------------------------------------------------------------------------*/

export const Status = Object.freeze({
	INDEX_MODIFIED: 0,
	INDEX_ADDED: 1,
	INDEX_DELETED: 2,
	INDEX_RENAMED: 3,
	INDEX_COPIED: 4,

	MODIFIED: 5,
	DELETED: 6,
	UNTRACKED: 7,
	IGNORED: 8,
	INTENT_TO_ADD: 9,
	INTENT_TO_RENAME: 10,
	TYPE_CHANGED: 11,

	ADDED_BY_US: 12,
	ADDED_BY_THEM: 13,
	DELETED_BY_US: 14,
	DELETED_BY_THEM: 15,
	BOTH_ADDED: 16,
	BOTH_DELETED: 17,
	BOTH_MODIFIED: 18,
});

export type Status = typeof Status[keyof typeof Status];

export class Resource {
	static getStatusLetter(type: Status): string {
		switch (type) {
			case Status.INDEX_MODIFIED:
			case Status.MODIFIED:
				return 'M';
			case Status.INDEX_ADDED:
			case Status.INTENT_TO_ADD:
				return 'A';
			case Status.INDEX_DELETED:
			case Status.DELETED:
				return 'D';
			case Status.INDEX_RENAMED:
			case Status.INTENT_TO_RENAME:
				return 'R';
			case Status.TYPE_CHANGED:
				return 'T';
			case Status.UNTRACKED:
				return 'U';
			case Status.IGNORED:
				return 'I';
			case Status.INDEX_COPIED:
				return 'C';
			case Status.BOTH_DELETED:
			case Status.ADDED_BY_US:
			case Status.DELETED_BY_THEM:
			case Status.ADDED_BY_THEM:
			case Status.DELETED_BY_US:
			case Status.BOTH_ADDED:
			case Status.BOTH_MODIFIED:
				return '!'; // Using ! instead of ⚠, because the latter looks really bad on windows
			default:
				throw new Error('Unknown git status: ' + type);
		}
	}

	static getStatusText(type: Status) {
		switch (type) {
			case Status.INDEX_MODIFIED: return 'Index Modified';
			case Status.MODIFIED: return 'Modified';
			case Status.INDEX_ADDED: return 'Index Added';
			case Status.INDEX_DELETED: return 'Index Deleted';
			case Status.DELETED: return 'Deleted';
			case Status.INDEX_RENAMED: return 'Index Renamed';
			case Status.INDEX_COPIED: return 'Index Copied';
			case Status.UNTRACKED: return 'Untracked';
			case Status.IGNORED: return 'Ignored';
			case Status.INTENT_TO_ADD: return 'Intent to Add';
			case Status.INTENT_TO_RENAME: return 'Intent to Rename';
			case Status.TYPE_CHANGED: return 'Type Changed';
			case Status.BOTH_DELETED: return 'Conflict: Both Deleted';
			case Status.ADDED_BY_US: return 'Conflict: Added By Us';
			case Status.DELETED_BY_THEM: return 'Conflict: Deleted By Them';
			case Status.ADDED_BY_THEM: return 'Conflict: Added By Them';
			case Status.DELETED_BY_US: return 'Conflict: Deleted By Us';
			case Status.BOTH_ADDED: return 'Conflict: Both Added';
			case Status.BOTH_MODIFIED: return 'Conflict: Both Modified';
			default: return '';
		}
	}

	static getStatusColor(type: Status): string {
		switch (type) {
			case Status.INDEX_MODIFIED:
				return 'gitDecoration.stageModifiedResourceForeground';
			case Status.MODIFIED:
			case Status.TYPE_CHANGED:
				return 'gitDecoration.modifiedResourceForeground';
			case Status.INDEX_DELETED:
				return 'gitDecoration.stageDeletedResourceForeground';
			case Status.DELETED:
				return 'gitDecoration.deletedResourceForeground';
			case Status.INDEX_ADDED:
			case Status.INTENT_TO_ADD:
				return 'gitDecoration.addedResourceForeground';
			case Status.INDEX_COPIED:
			case Status.INDEX_RENAMED:
			case Status.INTENT_TO_RENAME:
				return 'gitDecoration.renamedResourceForeground';
			case Status.UNTRACKED:
				return 'gitDecoration.untrackedResourceForeground';
			case Status.IGNORED:
				return 'gitDecoration.ignoredResourceForeground';
			case Status.BOTH_DELETED:
			case Status.ADDED_BY_US:
			case Status.DELETED_BY_THEM:
			case Status.ADDED_BY_THEM:
			case Status.DELETED_BY_US:
			case Status.BOTH_ADDED:
			case Status.BOTH_MODIFIED:
				return 'gitDecoration.conflictingResourceForeground';
			default:
				throw new Error('Unknown git status: ' + type);
		}
	}

}

export function parseIgnoreCheck(raw: string): string[] {
		const ignored = [];
		const elements = raw.split('\0');
		for (let i = 0; i < elements.length; i += 4) {
			const pattern = elements[i + 2];
			const path = elements[i + 3];
			if (pattern && !pattern.startsWith('!')) {
				ignored.push(path);
			}
		}
		return ignored;
	}
