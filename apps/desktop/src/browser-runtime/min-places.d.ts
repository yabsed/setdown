export type PlaceRecord = { url: string; title: string; isBookmarked: boolean; lastVisit: number; visitCount: number; searchTextCache?: {title: string; url: string} };
export function searchMinPlaces(items: PlaceRecord[], text: string, options: { searchBookmarks: boolean; limit: number }): PlaceRecord[];
