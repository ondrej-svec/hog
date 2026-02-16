Output docs/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

# Set up environment with Node 22 and project path
Env PATH "/Users/ondrejsvec/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
Env HOME "/Users/ondrejsvec"

# Start the board using node directly
Type "cd /Users/ondrejsvec/Projects/Bobo/hog && node --import tsx src/cli.ts board --live" Enter

# Wait for data to load
Sleep 8s

# Navigate down through items
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms

# Navigate back up
Type "k"
Sleep 300ms
Type "k"
Sleep 300ms

# Jump to next section
Tab
Sleep 1s

# Navigate in new section
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms

# Open search
Type "/"
Sleep 500ms
Type "feat"
Sleep 1.5s
Escape
Sleep 1s

# Show help overlay
Type "?"
Sleep 3s
Type "?"
Sleep 1s

# Quit
Type "q"
Sleep 1s
