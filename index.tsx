import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Song, PlayerState } from './types';
import { 
  PlayIcon, 
  PauseIcon, 
  Rewind10Icon,
  Forward10Icon,
  PlusIcon, 
  MusicIcon, 
  TrashIcon
} from './components/Icons';

const App = () => {
  // State
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const playlistRef = useRef<HTMLDivElement>(null);
  const activeSongRef = useRef<HTMLDivElement>(null);
  
  // Web Audio Context & Nodes
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fadeGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Loop Control
  const isVisualizerActiveRef = useRef<boolean>(false);

  // Init Audio Context (Singleton Pattern for this component)
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current || !audioRef.current) return;

    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      // 1. Create Source
      if (!sourceRef.current) {
        const source = ctx.createMediaElementSource(audioRef.current);
        sourceRef.current = source;
      }

      // 2. Create Nodes
      const fadeGain = ctx.createGain();
      fadeGain.gain.value = 1; 
      fadeGainRef.current = fadeGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.88;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);

      // 3. Connect Graph: Source -> FadeGain -> Analyser -> Destination
      if (sourceRef.current) {
        sourceRef.current.connect(fadeGain);
        fadeGain.connect(analyser);
        analyser.connect(ctx.destination);
      }

    } catch (e) {
      console.error("Audio Context Init Error:", e);
    }
  }, []);

  // Visualizer Loop - High Quality Mode
  const drawVisualizer = useCallback(() => {
    if (!isVisualizerActiveRef.current || !canvasRef.current || !analyserRef.current || !dataArrayRef.current) {
        return;
    }
    
    if (audioContextRef.current?.state === 'closed') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    requestRef.current = requestAnimationFrame(drawVisualizer);

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const sampleRate = audioContextRef.current?.sampleRate || 44100;

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);

    const bufferLength = analyser.frequencyBinCount;
    const minFreq = 20;
    const maxFreq = 16000;
    const logMin = Math.log(minFreq);
    const logMax = Math.log(maxFreq);
    
    // High Quality Rendering: Calculate points first
    const points: {x: number, y: number}[] = [];
    const steps = 180; 
    
    for (let i = 0; i <= steps; i++) {
        const percent = i / steps;
        const freq = Math.exp(logMin + (logMax - logMin) * percent);
        const index = Math.floor(freq / (sampleRate / analyser.fftSize));
        
        let val = 0;
        if (index >= 0 && index < bufferLength) {
            val = dataArray[index];
        }

        // Noise Gate
        const NOISE_THRESHOLD = 10;
        if (val < NOISE_THRESHOLD) {
             val = 0;
        } else {
             val = (val - NOISE_THRESHOLD) / (255 - NOISE_THRESHOLD);
             val = Math.pow(val, 2.0);
        }

        // EQ
        let weight = 1.0;
        if (freq < 60) weight = Math.max(0.1, (freq - 20) / 40);
        if (freq >= 200 && freq <= 4000) {
             const center = 1000; 
             const dist = Math.abs(freq - center);
             const boost = Math.max(0, 1.2 - (dist / 2000)); 
             weight += boost * 0.6;
        }
        if (freq > 6000) weight *= 1.3;
        val *= weight;

        const x = width * percent;
        const amp = val * (height * 0.25); 
        
        points.push({x, y: amp});
    }

    // Heavy Smoothing for Liquid Feel (3 passes)
    // This creates the high-quality, organic "blob" look
    const smoothPoints = [...points];
    const passes = 3;
    for (let p = 0; p < passes; p++) {
        for (let i = 1; i < smoothPoints.length - 1; i++) {
            smoothPoints[i].y = (smoothPoints[i-1].y + smoothPoints[i].y + smoothPoints[i+1].y) / 3;
        }
    }

    // Draw
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Top
    for (let i = 0; i < smoothPoints.length - 1; i++) {
        const p0 = smoothPoints[i];
        const p1 = smoothPoints[i+1];
        const midX = (p0.x + p1.x) / 2;
        const midY = centerY - ((p0.y + p1.y) / 2);
        ctx.quadraticCurveTo(p0.x, centerY - p0.y, midX, midY);
    }
    const last = smoothPoints[smoothPoints.length-1];
    ctx.lineTo(last.x, centerY - last.y);
    ctx.lineTo(width, centerY);

    // Bottom (Mirror)
    for (let i = smoothPoints.length - 1; i > 0; i--) {
        const p0 = smoothPoints[i];
        const p1 = smoothPoints[i-1];
        const midX = (p0.x + p1.x) / 2;
        const midY = centerY + ((p0.y + p1.y) / 2);
        ctx.quadraticCurveTo(p0.x, centerY + p0.y, midX, midY);
    }
    
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, centerY - height/2, 0, centerY + height/2);
    gradient.addColorStop(0, 'rgba(138, 182, 249, 0.0)');
    gradient.addColorStop(0.3, 'rgba(138, 182, 249, 0.4)');
    gradient.addColorStop(0.5, 'rgba(138, 182, 249, 0.9)');
    gradient.addColorStop(0.7, 'rgba(138, 182, 249, 0.4)');
    gradient.addColorStop(1, 'rgba(138, 182, 249, 0.0)');
    
    ctx.fillStyle = gradient;
    ctx.fill();
  }, []);

  // Playlist Auto-Scroll
  useEffect(() => {
    if (activeSongRef.current && playlistRef.current) {
      activeSongRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentSongIndex]);

  // Handlers
  const togglePlay = useCallback(async () => {
    if (!audioRef.current || currentSongIndex === -1) return;

    // Ensure Audio Context is ready
    if (!audioContextRef.current) initAudioContext();
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const ctx = audioContextRef.current;
    const fadeGain = fadeGainRef.current;

    if (isPlaying) {
        // PAUSE SEQUENCE
        setIsPlaying(false); 
        
        if (ctx && fadeGain) {
            fadeGain.gain.cancelScheduledValues(ctx.currentTime);
            fadeGain.gain.setValueAtTime(fadeGain.gain.value, ctx.currentTime);
            fadeGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        }

        setTimeout(() => {
            if (audioRef.current) audioRef.current.pause();
            
            // Allow visualizer to run one more frame to clear gracefully or keep showing silence
            isVisualizerActiveRef.current = false;
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
                requestRef.current = null;
            }
            if (canvasRef.current) {
                const c = canvasRef.current;
                const cx = c.getContext('2d');
                if (cx) cx.clearRect(0,0, c.width, c.height);
            }
        }, 500);

    } else {
        // PLAY SEQUENCE
        if (audioRef.current) {
            audioRef.current.volume = 1.0; 
            
            if (!isVisualizerActiveRef.current) {
                isVisualizerActiveRef.current = true;
                drawVisualizer();
            }

            if (ctx && fadeGain) {
                fadeGain.gain.cancelScheduledValues(ctx.currentTime);
                fadeGain.gain.setValueAtTime(0, ctx.currentTime);
            }

            await audioRef.current.play();
            setIsPlaying(true);

            if (ctx && fadeGain) {
                fadeGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
            }
        }
    }
  }, [currentSongIndex, isPlaying, initAudioContext, drawVisualizer]);

  // Handle Song Change (Auto Play)
  useEffect(() => {
    let mounted = true;

    const changeSong = async () => {
        if (currentSongIndex !== -1 && songs[currentSongIndex]) {
            if (audioRef.current) {
                audioRef.current.src = songs[currentSongIndex].url;
                
                if (isPlaying) {
                    if (!audioContextRef.current) initAudioContext();
                    if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();

                    const ctx = audioContextRef.current;
                    const fadeGain = fadeGainRef.current;
                    
                    try {
                        if (!isVisualizerActiveRef.current) {
                            isVisualizerActiveRef.current = true;
                            drawVisualizer();
                        }
                        
                        if (ctx && fadeGain) {
                           fadeGain.gain.cancelScheduledValues(ctx.currentTime);
                           fadeGain.gain.setValueAtTime(0, ctx.currentTime);
                        }

                        await audioRef.current.play();
                        
                        if (ctx && fadeGain) {
                           fadeGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
                        }
                    } catch (e) {
                        console.error("Auto-play failed", e);
                        if (mounted) setIsPlaying(false);
                    }
                }
            }
        }
    };
    
    changeSong();
    
    return () => { mounted = false; };
  }, [currentSongIndex, initAudioContext, drawVisualizer]);

  const addFiles = (files: File[]) => {
    const newSongs: Song[] = files
      .filter(file => file.type.startsWith('audio/'))
      .map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        title: file.name.replace(/\.[^/.]+$/, ""),
        url: URL.createObjectURL(file),
        file,
      }));
    
    setSongs(prev => {
      const updated = [...prev, ...newSongs];
      if (currentSongIndex === -1 && updated.length > 0) {
        setCurrentSongIndex(0);
      }
      return updated;
    });
  };
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) addFiles(Array.from(files));
  };

  const playSong = useCallback((index: number) => {
    if (index >= 0 && index < songs.length) {
      setCurrentSongIndex(index);
      setIsPlaying(true);
    }
  }, [songs.length]);

  const nextSong = useCallback(() => {
    if (songs.length === 0) return;
    const nextIndex = (currentSongIndex + 1) % songs.length;
    playSong(nextIndex);
  }, [currentSongIndex, songs.length, playSong]);

  const skipTime = useCallback((amount: number) => {
    if (audioRef.current) {
      const newTime = audioRef.current.currentTime + amount;
      audioRef.current.currentTime = Math.min(Math.max(newTime, 0), duration || 0);
      setCurrentTime(audioRef.current.currentTime);
    }
  }, [duration]);

  const deleteSong = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    const songToDelete = songs.find(s => s.id === id);
    if (songToDelete) URL.revokeObjectURL(songToDelete.url);

    const indexToRemove = songs.findIndex(s => s.id === id);
    if (indexToRemove === currentSongIndex) {
      setIsPlaying(false);
      audioRef.current?.pause();
      isVisualizerActiveRef.current = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      
      setCurrentSongIndex(-1);
      if (canvasRef.current) {
         const ctx = canvasRef.current.getContext('2d');
         if (ctx) ctx.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
      }
    } else if (indexToRemove < currentSongIndex) {
      setCurrentSongIndex(currentSongIndex - 1);
    }
    setSongs(songs.filter(s => s.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      songs.forEach(song => URL.revokeObjectURL(song.url));
    };
  }, []);

  // Media Session
  const currentSong = songs[currentSongIndex];
  useEffect(() => {
    if ('mediaSession' in navigator && currentSong) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentSong.title,
            artist: 'Pastel Wave Player',
            album: 'Playlist',
             artwork: [
                { src: 'https://placehold.co/512x512/8ab6f9/ffffff?text=Music', sizes: '512x512', type: 'image/png' }
            ]
        });
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('nexttrack', nextSong);
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            if (songs.length === 0) return;
            const prevIndex = (currentSongIndex - 1 + songs.length) % songs.length;
            playSong(prevIndex);
        });
    }
  }, [currentSong, togglePlay, nextSong, playSong, songs.length, currentSongIndex]);

  return (
    <div 
      className={`relative w-full max-w-md h-[90vh] bg-pastel-panel rounded-3xl shadow-[0_20px_40px_rgba(106,151,219,0.3)] flex flex-col overflow-hidden transition-all duration-300 ${isDragOver ? 'scale-105 ring-4 ring-white/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <audio 
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={nextSong}
        crossOrigin="anonymous" 
      />

      {/* Top Section: Visualizer */}
      <div className="relative w-full h-60 bg-pastel-bg/10 flex items-center justify-center">
        {currentSong ? (
           <canvas 
             ref={canvasRef} 
             width={400} 
             height={240} 
             className="w-full h-full object-contain"
           />
        ) : (
          <div className="text-pastel-dark flex flex-col items-center animate-pulse">
            <MusicIcon className="w-16 h-16 mb-2 opacity-50" />
            <p className="font-semibold text-lg opacity-70">No Music Selected</p>
          </div>
        )}
      </div>

      {/* Middle: Controls */}
      <div className="bg-white/60 p-6 flex flex-col items-center shadow-sm z-10 relative">
        <div className="w-full mb-4 overflow-hidden relative">
          <div className="w-full overflow-hidden whitespace-nowrap">
            <div 
              className={`text-pastel-dark font-bold text-xl ${currentSong ? 'animate-marquee' : ''}`}
              style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
            >
              {currentSong ? `${currentSong.title}  ***  ${currentSong.title}  ***  ` : "Pastel Wave Player"}
            </div>
          </div>
          <div className="text-center w-full">
            <p className="text-pastel-dark/60 text-sm mt-1">
              {currentSong ? "Now Playing" : "Drag & drop audio files"}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full flex items-center gap-3 text-xs text-pastel-dark font-bold mb-4">
          <span>{formatTime(currentTime)}</span>
          <div className="relative flex-1 h-2 bg-pastel-bar/50 rounded-full group cursor-pointer">
            <div 
              className="absolute top-0 left-0 h-full bg-pastel-bg rounded-full group-hover:bg-pastel-accent transition-colors" 
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            <input 
              type="range" 
              min="0" 
              max={duration || 0} 
              value={currentTime}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = val;
                setCurrentTime(val);
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Playback Buttons */}
        <div className="flex items-center justify-center gap-6 w-full">
          <button 
            onClick={() => skipTime(-10)} 
            className="text-pastel-dark hover:text-pastel-accent transition-colors flex flex-col items-center justify-center"
            title="-10s"
          >
            <Rewind10Icon className="w-8 h-8" />
          </button>
          
          <button 
            onClick={togglePlay}
            className="w-16 h-16 bg-pastel-bg text-white rounded-full flex items-center justify-center shadow-lg hover:bg-pastel-accent hover:scale-105 transition-all active:scale-95"
          >
            {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8 ml-1" />}
          </button>

          <button 
            onClick={() => skipTime(10)} 
            className="text-pastel-dark hover:text-pastel-accent transition-colors flex flex-col items-center justify-center"
            title="+10s"
          >
            <Forward10Icon className="w-8 h-8" />
          </button>
        </div>
      </div>

      {/* Bottom: Playlist */}
      <div 
        ref={playlistRef}
        className="flex-1 bg-white/30 overflow-y-auto p-4 custom-scrollbar"
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-pastel-dark font-bold text-sm uppercase tracking-wider opacity-70">Playlist</h3>
          <label className="cursor-pointer group">
            <input type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm text-pastel-dark hover:scale-110 transition-transform hover:bg-pastel-bg hover:text-white">
              <PlusIcon className="w-4 h-4" />
            </div>
          </label>
        </div>
        
        {songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-pastel-dark/50 text-sm">
             <p>Playlist is empty</p>
             <label className="mt-2 text-pastel-bg underline cursor-pointer hover:text-pastel-accent">
               <input type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
               Add songs
             </label>
          </div>
        ) : (
          <div className="space-y-2">
            {songs.map((song, index) => (
              <div 
                key={song.id}
                ref={currentSongIndex === index ? activeSongRef : null}
                onClick={() => playSong(index)}
                className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                  currentSongIndex === index 
                    ? 'bg-white shadow-sm text-pastel-bg' 
                    : 'hover:bg-white/50 text-pastel-dark'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    currentSongIndex === index ? 'bg-pastel-bg text-white' : 'bg-pastel-panel text-pastel-dark'
                  }`}>
                    {isPlaying && currentSongIndex === index ? (
                      <div className="w-3 h-3 bg-white rounded-sm animate-spin-slow" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className="truncate font-semibold text-sm max-w-[160px]">{song.title}</span>
                </div>
                
                <button 
                  onClick={(e) => deleteSong(e, song.id)}
                  className="p-1.5 rounded-full hover:bg-red-100 text-pastel-dark/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pastel-bg to-transparent opacity-20"></div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}