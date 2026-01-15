export interface Song {
  id: string;
  title: string;
  url: string;
  file?: File;
  duration?: number;
}

export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}
