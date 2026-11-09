# Gera agent\instalador\saida\AgenteOS.msi (instalador do agente de inventário do sistema de OS).
# Uso: pwsh agent/instalador/build-msi.ps1 [-Version 0.1.0] [-Certificado caminho.pfx -SenhaCertificado ...]
# Sem -Certificado o MSI sai sem assinatura (o Windows mostra "editor desconhecido" ao instalar).
param(
    [string]$Version = '0.1.0',
    [string]$Certificado,
    [string]$SenhaCertificado
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$agent = Split-Path $here -Parent
$publish = Join-Path $here 'obj-publish'
$saida = Join-Path $here 'saida'
$wixVersion = '5.0.2' # o mesmo do dotnet-tools.json (WiX 5 é MS-RL)

function Fail([string]$message) { Write-Host "ERRO: $message" -ForegroundColor Red; exit 1 }
function Run([string]$what) {
    & $args[0] $args[1..($args.Count - 1)]
    if ($LASTEXITCODE -ne 0) { Fail "$what falhou (código $LASTEXITCODE). Veja as mensagens acima." }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "Versão '$Version' inválida: use três números, como 0.1.0." }
if ($Certificado -and -not (Test-Path $Certificado)) { Fail "Certificado '$Certificado' não encontrado." }

# 1. publicar o agente em um .exe único, com o .NET junto (não depende de nada instalado no PC do cliente)
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
Write-Host 'Publicando o agente...'
Run 'Publicar OsAgent' dotnet publish (Join-Path $agent 'OsAgent') -c Release -r win-x64 --self-contained `
    -p:PublishSingleFile=true -p:Version=$Version -o $publish -nologo -v q

# 2. WiX (ferramenta local do dotnet-tools.json) e extensões no cache do usuário (%USERPROFILE%\.wix)
Push-Location $here
try {
    Run 'Restaurar o WiX' dotnet tool restore
    foreach ($ext in 'WixToolset.UI.wixext', 'WixToolset.Util.wixext') {
        Run "Baixar a extensão $ext" dotnet tool run wix extension add -g "$ext/$wixVersion"
    }
    New-Item -ItemType Directory -Force $saida | Out-Null
    $msi = Join-Path $saida 'AgenteOS.msi'
    Write-Host 'Gerando o AgenteOS.msi...'
    Run 'Gerar o MSI' dotnet tool run wix build (Join-Path $here 'AgenteOS.wxs') -arch x64 -culture pt-BR -culture en-US `
        -ext "WixToolset.UI.wixext/$wixVersion" -ext "WixToolset.Util.wixext/$wixVersion" `
        -d "Version=$Version" -d "PublishDir=$publish" -d "AvisoRtf=$(Join-Path $here 'aviso.rtf')" `
        -intermediatefolder (Join-Path $here 'obj') -o $msi
}
finally { Pop-Location }

# 3. assinatura opcional
if ($Certificado) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName | Select-Object -Last 1
    if (-not $signtool) { Fail 'signtool.exe não encontrado (instale o Windows SDK).' }
    $args2 = @('sign', '/f', $Certificado, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256')
    if ($SenhaCertificado) { $args2 += @('/p', $SenhaCertificado) }
    Run 'Assinar o MSI' $signtool.FullName @args2 $msi
}

# 4. resultado
$file = Get-Item $msi
Write-Host ''
Write-Host "Pronto: $($file.FullName)" -ForegroundColor Green
Write-Host ("Tamanho: {0:N1} MB" -f ($file.Length / 1MB))
Write-Host "SHA-256: $((Get-FileHash $msi -Algorithm SHA256).Hash)"
