import {themeFlags} from '../../flags.js'
import {getThemeStore} from '../../utilities/theme-store.js'
import ThemeCommand from '../../utilities/theme-command.js'
import {Flags} from '@oclif/core'
import {cli, session, abort, system, output} from '@shopify/cli-kit'
import {execCLI2} from '@shopify/cli-kit/node/ruby'

export default class Dev extends ThemeCommand {
  static description =
    'Uploads the current theme as a development theme to the connected store, then prints theme editor and preview URLs to your terminal. While running, changes will push to the store in real time.'

  static flags = {
    ...cli.globalFlags,
    path: themeFlags.path,
    host: Flags.string({
      description: 'Set which network interface the web server listens on. The default value is 127.0.0.1.',
      env: 'SHOPIFY_FLAG_HOST',
    }),
    'live-reload': Flags.string({
      description: `The live reload mode switches the server behavior when a file is modified:
- hot-reload Hot reloads local changes to CSS and sections (default)
- full-page  Always refreshes the entire page
- off        Deactivate live reload`,
      default: 'hot-reload',
      options: ['hot-reload', 'full-page', 'off'],
      env: 'SHOPIFY_FLAG_LIVE_RELOAD',
    }),
    poll: Flags.boolean({
      description: 'Force polling to detect file changes.',
      env: 'SHOPIFY_FLAG_POLL',
    }),
    'theme-editor-sync': Flags.boolean({
      char: 'e',
      description: 'Synchronize Theme Editor updates in the local theme files.',
      env: 'SHOPIFY_FLAG_THEME_EDITOR_SYNC',
    }),
    port: Flags.string({
      description: 'Local port to serve theme preview from.',
      env: 'SHOPIFY_FLAG_PORT',
    }),
    store: themeFlags.store,
    theme: Flags.string({
      char: 't',
      description: 'Theme ID or name of the remote theme.',
      env: 'SHOPIFY_FLAG_THEME_ID',
    }),
    only: Flags.string({
      char: 'o',
      multiple: true,
      description: 'Hot reload only files that match the specified pattern.',
      env: 'SHOPIFY_FLAG_ONLY',
    }),
    ignore: Flags.string({
      char: 'x',
      multiple: true,
      description: 'Skip hot reloading any files that match the specified pattern.',
      env: 'SHOPIFY_FLAG_IGNORE',
    }),
    stable: Flags.boolean({
      hidden: true,
      description:
        'Performs the upload by relying in the legacy upload approach (slower, but it might be more stable in some scenarios)',
      env: 'SHOPIFY_FLAG_STABLE',
    }),
    force: Flags.boolean({
      hidden: true,
      char: 'f',
      description: 'Proceed without confirmation, if current directory does not seem to be theme directory.',
      env: 'SHOPIFY_FLAG_FORCE',
    }),
    password: themeFlags.password,
  }

  static cli2Flags = [
    'host',
    'live-reload',
    'poll',
    'theme-editor-sync',
    'port',
    'theme',
    'only',
    'ignore',
    'stable',
    'force',
  ]

  // Tokens are valid for 120m, better to be safe and refresh every 110min
  ThemeRefreshTimeoutInMs = 110 * 60 * 1000

  // Sleep timeout, server could run forever but we need to put a number. 1 Year.
  HardTimeoutInSeconds = 60 * 60 * 24 * 365

  /**
   * Executes the theme serve command.
   * Every 110 minutes, it will refresh the session token and restart the server.
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Dev)

    const flagsToPass = this.passThroughFlags(flags, {allowedFlags: Dev.cli2Flags})
    const command = ['theme', 'serve', flags.path, ...flagsToPass]

    const store = await getThemeStore(flags)

    let controller: abort.Controller = new abort.Controller()

    const refreshThemeSessionInterval = setInterval(() => {
      output.debug('Refreshing theme session token and restarting theme server...')
      controller.abort()
      controller = new abort.Controller()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.execute(store, flags.password, command, controller)
    }, this.ThemeRefreshTimeoutInMs)

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.execute(store, flags.password, command, controller)
    await system.sleep(this.HardTimeoutInSeconds)
    clearInterval(refreshThemeSessionInterval)
  }

  async execute(store: string, password: string | undefined, command: string[], controller: abort.Controller) {
    const adminSession = await session.ensureAuthenticatedThemes(store, password, [], true)
    const storefrontToken = await session.ensureAuthenticatedStorefront([], password)
    return execCLI2(command, {adminSession, storefrontToken, signal: controller.signal})
  }
}
