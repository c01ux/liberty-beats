import { RootStore } from '../store'
import { observeStore } from '../store/observers'

import * as Tone from 'tone'
import {
  selectTrackIdInPlayingPreviewloop,
  selectPlayingTrackKeys,
  selectTrackPreviewLoop,
} from '../features/daw/instrument/store/selectors'
import { selectTracks } from '../features/daw/playlist/store/selectors'
import { selectIsPlaying } from '../features/daw/player-bar/store/selectors'
import { Track } from '../model/track/track'
import { Channel } from './channel/channel'
import { Clock } from './time/clock/clock'
import { Metronome } from './metronome/metronome'
import { Volume } from './volume/volume'
export default class Sequencer {
  private _store: RootStore
  private _channelsByTrackID: Map<string, Channel> = new Map()

  private _clock: Clock
  private _lastClockPositionBeforeLoop: number = 0

  constructor(store: RootStore) {
    this._store = store

    this._clock = new Clock(this._store)
    new Metronome(this._store)
    new Volume(this._store)

    this.registerStoreListeners()
  }

  registerStoreListeners() {
    observeStore(this._store, selectIsPlaying, async (newState) => {
      if (newState) {
        await this.startTracks()
      } else {
        this.pause()
      }
    })

    observeStore(this._store, selectPlayingTrackKeys, (newPlayingTrackKeys) => {
      newPlayingTrackKeys.forEach((item) => {
        const { keys, trackId } = item

        const trackChannel = this._channelsByTrackID.get(trackId)
        trackChannel?.playKeys(keys)
      })
    })

    observeStore(this._store, selectTracks, (newState, oldState) => {
      if (oldState === newState) return
      this.generateTracks(newState)
    })

    observeStore(this._store, selectTrackPreviewLoop, (newPreviewLoop) => {
      if (!newPreviewLoop || !newPreviewLoop.loopBar) return

      this._channelsByTrackID
        .get(newPreviewLoop.trackId)
        ?.setPreviewLoopBar(newPreviewLoop.loopBar)
    })

    observeStore(
      this._store,
      selectTrackIdInPlayingPreviewloop,
      (previewLoopPlayingTrackId, oldPreviewLoopPlayingTrackId) => {
        // the preview loop bar will be placed at the start of the track
        if (previewLoopPlayingTrackId) {
          this._lastClockPositionBeforeLoop = this._clock.currentTick
          this._clock.requestNewTickPosition(0)

          Tone.Transport.loop = true
          Tone.Transport.loopStart = 0
          Tone.Transport.loopEnd = '1m'

          this._channelsByTrackID.forEach((channel) => {
            if (channel.trackId === previewLoopPlayingTrackId) {
              channel.startPreviewLoop()
            }
            channel.setOtherTrackIsPreviewing(
              channel.trackId !== previewLoopPlayingTrackId
            )
          })

          this.startTracks()
        } else {
          this.stop()
          Tone.Transport.loop = false
          this._clock.requestNewTickPosition(this._lastClockPositionBeforeLoop)

          this._channelsByTrackID.forEach((channel) => {
            channel.setOtherTrackIsPreviewing(false)

            // reset the preview loop
            if (channel.trackId === oldPreviewLoopPlayingTrackId) {
              channel.stopPreviewLoop()
            }
          })
        }
      }
    )
  }

  async startTracks() {
    await Tone.start()
    Tone.Transport.start()
  }

  generateTracks(newTracks: Readonly<Track[]>) {
    newTracks.forEach((track) => {
      if (this._channelsByTrackID.has(track.id)) {
        this._channelsByTrackID.get(track.id)?.updateFromTrack(track)
      } else {
        const channel = new Channel(track)
        this._channelsByTrackID.set(track.id, channel)
      }
    })
  }

  stop() {
    Tone.Transport.stop()
  }

  pause() {
    Tone.Transport.pause()
  }
}
