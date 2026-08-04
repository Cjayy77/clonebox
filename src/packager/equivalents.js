// Curated cross-OS package equivalence table.
//
// Design rule: every mapping here is verified by hand. Nothing is inferred
// from name similarity, because near-misses install the wrong software —
// apt's `python` is not Python 3, and `python-is-python2` would match a
// fuzzy search for "python". If a tool isn't in this table, the installer
// reports "no known equivalent" rather than guessing.
//
// `aliases` lets us resolve backwards: given a winget ID, choco name, brew
// formula, or apt package from a scan, find the canonical entry.

const TABLE = [
  // ---------- Core dev tooling ----------
  {
    key: 'git', label: 'Git',
    win32: { manager: 'winget', cmd: 'winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install git' },
    linux: { manager: 'apt', cmd: 'apt install -y git', needsElevation: true },
    aliases: { winget: ['Git.Git'], choco: ['git', 'git.install'], brew: ['git'], apt: ['git'] },
  },
  {
    key: 'gh', label: 'GitHub CLI',
    win32: { manager: 'winget', cmd: 'winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install gh' },
    linux: { manager: 'apt', cmd: 'apt install -y gh', needsElevation: true, note: 'May need the GitHub CLI apt repo added first.' },
    aliases: { winget: ['GitHub.cli'], choco: ['gh'], brew: ['gh'], apt: ['gh'] },
  },
  {
    key: 'node', label: 'Node.js',
    win32: { manager: 'winget', cmd: 'winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install node' },
    linux: { manager: 'apt', cmd: 'apt install -y nodejs npm', needsElevation: true, note: 'Distro nodejs can lag well behind LTS — nvm or fnm is usually better.' },
    aliases: { winget: ['OpenJS.NodeJS', 'OpenJS.NodeJS.LTS'], choco: ['nodejs', 'nodejs-lts'], brew: ['node'], apt: ['nodejs'] },
  },
  {
    key: 'python3', label: 'Python 3',
    win32: { manager: 'winget', cmd: 'winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install python@3.12' },
    linux: { manager: 'apt', cmd: 'apt install -y python3 python3-pip', needsElevation: true },
    aliases: { winget: ['Python.Python.3', 'Python.Python.3.12', 'Python.Python.3.11'], choco: ['python', 'python3'], brew: ['python@3.12', 'python@3.11', 'python3'], apt: ['python3'] },
  },
  {
    key: 'openjdk', label: 'OpenJDK',
    win32: { manager: 'winget', cmd: 'winget install --id EclipseAdoptium.Temurin.21.JDK -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install openjdk@21' },
    linux: { manager: 'apt', cmd: 'apt install -y openjdk-21-jdk', needsElevation: true },
    aliases: { winget: ['EclipseAdoptium.Temurin.21.JDK', 'Oracle.JDK.21'], choco: ['openjdk', 'temurin'], brew: ['openjdk', 'openjdk@21', 'openjdk@17'], apt: ['openjdk-21-jdk', 'openjdk-17-jdk', 'default-jdk'] },
  },
  {
    key: 'go', label: 'Go',
    win32: { manager: 'winget', cmd: 'winget install --id GoLang.Go -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install go' },
    linux: { manager: 'apt', cmd: 'apt install -y golang-go', needsElevation: true },
    aliases: { winget: ['GoLang.Go'], choco: ['golang'], brew: ['go'], apt: ['golang-go', 'golang'] },
  },
  {
    key: 'rust', label: 'Rust (rustup)',
    win32: { manager: 'winget', cmd: 'winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install rustup-init' },
    linux: { manager: 'script', cmd: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y", note: 'rustup.rs is the official route on Linux; distro packages lag.' },
    aliases: { winget: ['Rustlang.Rustup', 'Rustlang.Rust.MSVC'], choco: ['rustup.install', 'rust'], brew: ['rustup-init', 'rust'], apt: ['rustc', 'cargo'] },
  },
  {
    key: 'dotnet-sdk', label: '.NET SDK',
    win32: { manager: 'winget', cmd: 'winget install --id Microsoft.DotNet.SDK.8 -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask dotnet-sdk' },
    linux: { manager: 'apt', cmd: 'apt install -y dotnet-sdk-8.0', needsElevation: true },
    aliases: { winget: ['Microsoft.DotNet.SDK.8', 'Microsoft.DotNet.SDK.7'], choco: ['dotnet-sdk'], brew: ['dotnet-sdk'], apt: ['dotnet-sdk-8.0'] },
  },
  {
    key: 'php', label: 'PHP',
    win32: { manager: 'winget', cmd: 'winget install --id PHP.PHP.8.3 -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install php' },
    linux: { manager: 'apt', cmd: 'apt install -y php', needsElevation: true },
    aliases: { winget: ['PHP.PHP.8.3'], choco: ['php'], brew: ['php'], apt: ['php'] },
  },
  {
    key: 'ruby', label: 'Ruby',
    win32: { manager: 'winget', cmd: 'winget install --id RubyInstallerTeam.Ruby.3.3 -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install ruby' },
    linux: { manager: 'apt', cmd: 'apt install -y ruby-full', needsElevation: true },
    aliases: { winget: ['RubyInstallerTeam.Ruby.3.3'], choco: ['ruby'], brew: ['ruby'], apt: ['ruby-full', 'ruby'] },
  },

  // ---------- Editors & IDEs ----------
  {
    key: 'vscode', label: 'Visual Studio Code',
    win32: { manager: 'winget', cmd: 'winget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask visual-studio-code' },
    linux: { manager: 'snap', cmd: 'snap install code --classic', needsElevation: true },
    aliases: { winget: ['Microsoft.VisualStudioCode'], choco: ['vscode'], brew: ['visual-studio-code'], apt: ['code'], snap: ['code'] },
  },
  {
    key: 'neovim', label: 'Neovim',
    win32: { manager: 'winget', cmd: 'winget install --id Neovim.Neovim -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install neovim' },
    linux: { manager: 'apt', cmd: 'apt install -y neovim', needsElevation: true },
    aliases: { winget: ['Neovim.Neovim'], choco: ['neovim'], brew: ['neovim'], apt: ['neovim'] },
  },
  {
    key: 'android-studio', label: 'Android Studio',
    win32: { manager: 'winget', cmd: 'winget install --id Google.AndroidStudio -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask android-studio' },
    linux: { manager: 'snap', cmd: 'snap install android-studio --classic', needsElevation: true },
    aliases: { winget: ['Google.AndroidStudio'], choco: ['androidstudio'], brew: ['android-studio'], snap: ['android-studio'] },
  },

  // ---------- Mobile / cross-platform SDKs ----------
  {
    key: 'flutter', label: 'Flutter SDK',
    win32: { manager: 'manual', cmd: null, note: 'Use fvm (dart pub global activate fvm) or download from flutter.dev; winget has no official Flutter package.' },
    darwin: { manager: 'brew', cmd: 'brew install --cask flutter' },
    linux: { manager: 'snap', cmd: 'snap install flutter --classic', needsElevation: true },
    aliases: { brew: ['flutter'], snap: ['flutter'] },
  },
  {
    key: 'ollama', label: 'Ollama',
    win32: { manager: 'winget', cmd: 'winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install ollama' },
    linux: { manager: 'script', cmd: 'curl -fsSL https://ollama.com/install.sh | sh', note: 'Official Linux install route.' },
    aliases: { winget: ['Ollama.Ollama'], choco: ['ollama'], brew: ['ollama'] },
  },

  // ---------- CLI utilities ----------
  {
    key: 'jq', label: 'jq',
    win32: { manager: 'winget', cmd: 'winget install --id jqlang.jq -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install jq' },
    linux: { manager: 'apt', cmd: 'apt install -y jq', needsElevation: true },
    aliases: { winget: ['jqlang.jq', 'stedolan.jq'], choco: ['jq'], brew: ['jq'], apt: ['jq'] },
  },
  {
    key: 'curl', label: 'curl',
    win32: { manager: 'winget', cmd: 'winget install --id cURL.cURL -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install curl' },
    linux: { manager: 'apt', cmd: 'apt install -y curl', needsElevation: true },
    aliases: { winget: ['cURL.cURL'], choco: ['curl'], brew: ['curl'], apt: ['curl'] },
  },
  {
    key: 'wget', label: 'wget',
    win32: { manager: 'winget', cmd: 'winget install --id JernejSimoncic.wget -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install wget' },
    linux: { manager: 'apt', cmd: 'apt install -y wget', needsElevation: true },
    aliases: { winget: ['JernejSimoncic.wget'], choco: ['wget'], brew: ['wget'], apt: ['wget'] },
  },
  {
    key: 'ripgrep', label: 'ripgrep',
    win32: { manager: 'winget', cmd: 'winget install --id BurntSushi.ripgrep.MSVC -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install ripgrep' },
    linux: { manager: 'apt', cmd: 'apt install -y ripgrep', needsElevation: true },
    aliases: { winget: ['BurntSushi.ripgrep.MSVC'], choco: ['ripgrep'], brew: ['ripgrep'], apt: ['ripgrep'] },
  },
  {
    key: 'fzf', label: 'fzf',
    win32: { manager: 'winget', cmd: 'winget install --id junegunn.fzf -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install fzf' },
    linux: { manager: 'apt', cmd: 'apt install -y fzf', needsElevation: true },
    aliases: { winget: ['junegunn.fzf'], choco: ['fzf'], brew: ['fzf'], apt: ['fzf'] },
  },
  {
    key: 'tmux', label: 'tmux',
    win32: { manager: 'manual', cmd: null, note: 'No native Windows build; use tmux inside WSL.' },
    darwin: { manager: 'brew', cmd: 'brew install tmux' },
    linux: { manager: 'apt', cmd: 'apt install -y tmux', needsElevation: true },
    aliases: { brew: ['tmux'], apt: ['tmux'] },
  },
  {
    key: 'htop', label: 'htop',
    win32: { manager: 'manual', cmd: null, note: 'Use Task Manager or Process Explorer; htop is Unix-only.' },
    darwin: { manager: 'brew', cmd: 'brew install htop' },
    linux: { manager: 'apt', cmd: 'apt install -y htop', needsElevation: true },
    aliases: { brew: ['htop'], apt: ['htop'] },
  },
  {
    key: 'cmake', label: 'CMake',
    win32: { manager: 'winget', cmd: 'winget install --id Kitware.CMake -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install cmake' },
    linux: { manager: 'apt', cmd: 'apt install -y cmake', needsElevation: true },
    aliases: { winget: ['Kitware.CMake'], choco: ['cmake'], brew: ['cmake'], apt: ['cmake'] },
  },
  {
    key: 'ffmpeg', label: 'FFmpeg',
    win32: { manager: 'winget', cmd: 'winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install ffmpeg' },
    linux: { manager: 'apt', cmd: 'apt install -y ffmpeg', needsElevation: true },
    aliases: { winget: ['Gyan.FFmpeg'], choco: ['ffmpeg'], brew: ['ffmpeg'], apt: ['ffmpeg'] },
  },
  {
    key: 'imagemagick', label: 'ImageMagick',
    win32: { manager: 'winget', cmd: 'winget install --id ImageMagick.ImageMagick -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install imagemagick' },
    linux: { manager: 'apt', cmd: 'apt install -y imagemagick', needsElevation: true },
    aliases: { winget: ['ImageMagick.ImageMagick'], choco: ['imagemagick'], brew: ['imagemagick'], apt: ['imagemagick'] },
  },
  {
    key: '7zip', label: '7-Zip / p7zip',
    win32: { manager: 'winget', cmd: 'winget install --id 7zip.7zip -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install p7zip' },
    linux: { manager: 'apt', cmd: 'apt install -y p7zip-full', needsElevation: true },
    aliases: { winget: ['7zip.7zip'], choco: ['7zip'], brew: ['p7zip'], apt: ['p7zip-full'] },
  },

  // ---------- Containers / infra ----------
  {
    key: 'docker', label: 'Docker',
    win32: { manager: 'winget', cmd: 'winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask docker' },
    linux: { manager: 'apt', cmd: 'apt install -y docker.io', needsElevation: true, note: 'Linux runs the engine directly — no Docker Desktop needed. Add yourself to the docker group afterward.' },
    aliases: { winget: ['Docker.DockerDesktop'], choco: ['docker-desktop'], brew: ['docker'], apt: ['docker.io', 'docker-ce'] },
  },
  {
    key: 'kubectl', label: 'kubectl',
    win32: { manager: 'winget', cmd: 'winget install --id Kubernetes.kubectl -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install kubectl' },
    linux: { manager: 'snap', cmd: 'snap install kubectl --classic', needsElevation: true },
    aliases: { winget: ['Kubernetes.kubectl'], choco: ['kubernetes-cli'], brew: ['kubectl', 'kubernetes-cli'], snap: ['kubectl'] },
  },
  {
    key: 'terraform', label: 'Terraform',
    win32: { manager: 'winget', cmd: 'winget install --id Hashicorp.Terraform -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install terraform' },
    linux: { manager: 'snap', cmd: 'snap install terraform --classic', needsElevation: true },
    aliases: { winget: ['Hashicorp.Terraform'], choco: ['terraform'], brew: ['terraform'], snap: ['terraform'] },
  },
  {
    key: 'awscli', label: 'AWS CLI',
    win32: { manager: 'winget', cmd: 'winget install --id Amazon.AWSCLI -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install awscli' },
    linux: { manager: 'apt', cmd: 'apt install -y awscli', needsElevation: true },
    aliases: { winget: ['Amazon.AWSCLI'], choco: ['awscli'], brew: ['awscli'], apt: ['awscli'] },
  },

  // ---------- Databases ----------
  {
    key: 'postgresql', label: 'PostgreSQL',
    win32: { manager: 'winget', cmd: 'winget install --id PostgreSQL.PostgreSQL.16 -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install postgresql@16' },
    linux: { manager: 'apt', cmd: 'apt install -y postgresql', needsElevation: true },
    aliases: { winget: ['PostgreSQL.PostgreSQL', 'PostgreSQL.PostgreSQL.16'], choco: ['postgresql'], brew: ['postgresql@16', 'postgresql'], apt: ['postgresql'] },
  },
  {
    key: 'mysql', label: 'MySQL',
    win32: { manager: 'winget', cmd: 'winget install --id Oracle.MySQL -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install mysql' },
    linux: { manager: 'apt', cmd: 'apt install -y mysql-server', needsElevation: true },
    aliases: { winget: ['Oracle.MySQL'], choco: ['mysql'], brew: ['mysql'], apt: ['mysql-server'] },
  },
  {
    key: 'redis', label: 'Redis',
    win32: { manager: 'manual', cmd: null, note: 'No official Windows build — run Redis in WSL or Docker.' },
    darwin: { manager: 'brew', cmd: 'brew install redis' },
    linux: { manager: 'apt', cmd: 'apt install -y redis-server', needsElevation: true },
    aliases: { brew: ['redis'], apt: ['redis-server', 'redis'] },
  },
  {
    key: 'sqlite', label: 'SQLite',
    win32: { manager: 'winget', cmd: 'winget install --id SQLite.SQLite -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install sqlite' },
    linux: { manager: 'apt', cmd: 'apt install -y sqlite3', needsElevation: true },
    aliases: { winget: ['SQLite.SQLite'], choco: ['sqlite'], brew: ['sqlite'], apt: ['sqlite3'] },
  },
  {
    key: 'dbeaver', label: 'DBeaver',
    win32: { manager: 'winget', cmd: 'winget install --id dbeaver.dbeaver -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask dbeaver-community' },
    linux: { manager: 'snap', cmd: 'snap install dbeaver-ce', needsElevation: true },
    aliases: { winget: ['dbeaver.dbeaver'], choco: ['dbeaver'], brew: ['dbeaver-community'], snap: ['dbeaver-ce'] },
  },

  // ---------- Browsers & desktop apps ----------
  {
    key: 'chrome', label: 'Google Chrome',
    win32: { manager: 'winget', cmd: 'winget install --id Google.Chrome -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask google-chrome' },
    linux: { manager: 'apt', cmd: 'apt install -y google-chrome-stable', needsElevation: true, note: "Needs Google's apt repo; otherwise install chromium instead." },
    aliases: { winget: ['Google.Chrome'], choco: ['googlechrome'], brew: ['google-chrome'], apt: ['google-chrome-stable'] },
  },
  {
    key: 'firefox', label: 'Firefox',
    win32: { manager: 'winget', cmd: 'winget install --id Mozilla.Firefox -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask firefox' },
    linux: { manager: 'apt', cmd: 'apt install -y firefox', needsElevation: true },
    aliases: { winget: ['Mozilla.Firefox'], choco: ['firefox'], brew: ['firefox'], apt: ['firefox'], snap: ['firefox'] },
  },
  {
    key: 'postman', label: 'Postman',
    win32: { manager: 'winget', cmd: 'winget install --id Postman.Postman -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask postman' },
    linux: { manager: 'snap', cmd: 'snap install postman', needsElevation: true },
    aliases: { winget: ['Postman.Postman'], choco: ['postman'], brew: ['postman'], snap: ['postman'] },
  },
  {
    key: 'vlc', label: 'VLC',
    win32: { manager: 'winget', cmd: 'winget install --id VideoLAN.VLC -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask vlc' },
    linux: { manager: 'apt', cmd: 'apt install -y vlc', needsElevation: true },
    aliases: { winget: ['VideoLAN.VLC'], choco: ['vlc'], brew: ['vlc'], apt: ['vlc'], snap: ['vlc'] },
  },
  {
    key: 'obs', label: 'OBS Studio',
    win32: { manager: 'winget', cmd: 'winget install --id OBSProject.OBSStudio -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask obs' },
    linux: { manager: 'apt', cmd: 'apt install -y obs-studio', needsElevation: true },
    aliases: { winget: ['OBSProject.OBSStudio'], choco: ['obs-studio'], brew: ['obs'], apt: ['obs-studio'] },
  },
  {
    key: 'gimp', label: 'GIMP',
    win32: { manager: 'winget', cmd: 'winget install --id GIMP.GIMP -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask gimp' },
    linux: { manager: 'apt', cmd: 'apt install -y gimp', needsElevation: true },
    aliases: { winget: ['GIMP.GIMP'], choco: ['gimp'], brew: ['gimp'], apt: ['gimp'] },
  },
  {
    key: 'inkscape', label: 'Inkscape',
    win32: { manager: 'winget', cmd: 'winget install --id Inkscape.Inkscape -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask inkscape' },
    linux: { manager: 'apt', cmd: 'apt install -y inkscape', needsElevation: true },
    aliases: { winget: ['Inkscape.Inkscape'], choco: ['inkscape'], brew: ['inkscape'], apt: ['inkscape'] },
  },
  {
    key: 'blender', label: 'Blender',
    win32: { manager: 'winget', cmd: 'winget install --id BlenderFoundation.Blender -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask blender' },
    linux: { manager: 'snap', cmd: 'snap install blender --classic', needsElevation: true },
    aliases: { winget: ['BlenderFoundation.Blender'], choco: ['blender'], brew: ['blender'], snap: ['blender'] },
  },
  {
    key: 'slack', label: 'Slack',
    win32: { manager: 'winget', cmd: 'winget install --id SlackTechnologies.Slack -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask slack' },
    linux: { manager: 'snap', cmd: 'snap install slack', needsElevation: true },
    aliases: { winget: ['SlackTechnologies.Slack'], choco: ['slack'], brew: ['slack'], snap: ['slack'] },
  },
  {
    key: 'discord', label: 'Discord',
    win32: { manager: 'winget', cmd: 'winget install --id Discord.Discord -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask discord' },
    linux: { manager: 'snap', cmd: 'snap install discord', needsElevation: true },
    aliases: { winget: ['Discord.Discord'], choco: ['discord'], brew: ['discord'], snap: ['discord'] },
  },
  {
    key: 'spotify', label: 'Spotify',
    win32: { manager: 'winget', cmd: 'winget install --id Spotify.Spotify -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask spotify' },
    linux: { manager: 'snap', cmd: 'snap install spotify', needsElevation: true },
    aliases: { winget: ['Spotify.Spotify'], choco: ['spotify'], brew: ['spotify'], snap: ['spotify'] },
  },
  {
    key: 'zoom', label: 'Zoom',
    win32: { manager: 'winget', cmd: 'winget install --id Zoom.Zoom -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask zoom' },
    linux: { manager: 'snap', cmd: 'snap install zoom-client', needsElevation: true },
    aliases: { winget: ['Zoom.Zoom'], choco: ['zoom'], brew: ['zoom'], snap: ['zoom-client'] },
  },
  {
    key: 'figma', label: 'Figma',
    win32: { manager: 'winget', cmd: 'winget install --id Figma.Figma -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask figma' },
    linux: { manager: 'manual', cmd: null, note: 'No official Linux desktop app — use figma.com in a browser or a community build.' },
    aliases: { winget: ['Figma.Figma'], choco: ['figma'], brew: ['figma'] },
  },
  {
    key: 'notion', label: 'Notion',
    win32: { manager: 'winget', cmd: 'winget install --id Notion.Notion -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'brew', cmd: 'brew install --cask notion' },
    linux: { manager: 'manual', cmd: null, note: 'No official Linux app — use notion.so in a browser.' },
    aliases: { winget: ['Notion.Notion'], choco: ['notion'], brew: ['notion'] },
  },

  // ---------- Explicitly platform-exclusive: no equivalent exists ----------
  {
    key: 'powertoys', label: 'PowerToys',
    win32: { manager: 'winget', cmd: 'winget install --id Microsoft.PowerToys -e --accept-package-agreements --accept-source-agreements', needsElevation: true },
    darwin: { manager: 'none', cmd: null, note: 'Windows-only utility suite. Closest macOS analogues (Rectangle, Raycast) are separate tools, not equivalents — not installed automatically.' },
    linux: { manager: 'none', cmd: null, note: 'Windows-only utility suite. No direct Linux counterpart.' },
    aliases: { winget: ['Microsoft.PowerToys'], choco: ['powertoys'] },
  },
  {
    key: 'visual-studio', label: 'Visual Studio (full IDE)',
    win32: { manager: 'manual', cmd: null, note: 'Reinstall via the Visual Studio Installer, re-selecting the same workloads.' },
    darwin: { manager: 'none', cmd: null, note: 'Visual Studio for Mac is discontinued. VS Code or Rider are different products, not equivalents — not installed automatically.' },
    linux: { manager: 'none', cmd: null, note: 'No Linux version exists.' },
    aliases: { winget: ['Microsoft.VisualStudio.2022.Community'], choco: ['visualstudio2022community'] },
  },
  {
    key: 'xcode', label: 'Xcode',
    win32: { manager: 'none', cmd: null, note: 'macOS-only; required for iOS builds. No Windows equivalent exists.' },
    darwin: { manager: 'manual', cmd: null, note: 'Install from the Mac App Store, then run xcode-select --install.' },
    linux: { manager: 'none', cmd: null, note: 'macOS-only. No Linux equivalent exists.' },
    aliases: { brew: ['xcode'] },
  },
];

// Reverse index: "manager:packagename" (lowercased) -> canonical entry
const INDEX = new Map();
for (const entry of TABLE) {
  for (const [manager, names] of Object.entries(entry.aliases || {})) {
    for (const name of names) {
      INDEX.set(`${manager}:${name.toLowerCase()}`, entry);
    }
  }
  // Also allow lookup by canonical key and label
  INDEX.set(`key:${entry.key}`, entry);
}

// Find the table entry matching a scanned item, or null if unmapped.
function findEntry(item) {
  if (!item || !item.name) return null;
  const direct = INDEX.get(`${item.source}:${item.name.toLowerCase()}`);
  if (direct) return direct;
  // brew-cask items are indexed under 'brew'
  if (item.source === 'brew-cask') {
    const cask = INDEX.get(`brew:${item.name.toLowerCase()}`);
    if (cask) return cask;
  }
  // Portable SDK folders map by keyword (Flutter SDK -> flutter)
  if (item.source === 'portable-folder') {
    const lower = item.name.toLowerCase();
    for (const entry of TABLE) {
      if (lower.includes(entry.key)) return entry;
    }
  }
  return null;
}

// Build the equivalents block attached to each item in the manifest, so the
// installer scripts don't need this table shipped alongside them.
function buildEquivalents(item) {
  const entry = findEntry(item);
  if (!entry) return null;

  const out = { canonicalKey: entry.key, label: entry.label };
  for (const os of ['win32', 'darwin', 'linux']) {
    const target = entry[os];
    if (!target) continue;
    out[os] = {
      manager: target.manager,
      cmd: target.cmd || null,
      needsElevation: !!target.needsElevation,
      note: target.note || null,
    };
  }
  return out;
}

function tableSize() {
  return TABLE.length;
}

module.exports = { findEntry, buildEquivalents, tableSize, TABLE };
