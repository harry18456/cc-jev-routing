// The plugin's contract: the host state it keeps for a session.
//   session    the /jev on|off override: true or false while one is in force,
//              null while the settings decide. Held by the host, so a reload
//              of the plugin's code does not turn routing back on behind the
//              person's back.
//   view       a counter the band and the panel read while drawing; bumped
//              after every decision and every change, so they draw again.
//   bandHidden the band's own hide button, for this session.
//   writeScope where the panel's buttons persist a setting: the local file
//              (personal) or the project file (shared).
declare module 'claude-code' {
  interface PluginState {
    'jev-routing': {
      session: boolean | null
      view: number
      bandHidden: boolean
      writeScope: 'local' | 'project'
    }
  }
}
