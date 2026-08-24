$url = 'http://localhost:8787/'

$edgeCandidates = @()
if ($env:ProgramFiles) {
  $edgeCandidates += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
}
if (${env:ProgramFiles(x86)}) {
  $edgeCandidates += Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
}
if ($env:LOCALAPPDATA) {
  $edgeCandidates += Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'
}

$edgePath = $edgeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($edgePath) {
  Start-Process -FilePath $edgePath -ArgumentList @("--app=$url", '--new-window')
} else {
  Start-Process $url
}
