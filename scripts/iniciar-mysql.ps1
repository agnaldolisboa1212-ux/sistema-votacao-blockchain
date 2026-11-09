# Arranca o MySQL portatil instalado em E:\mysql (sem servico do Windows).
# Escuta apenas em 127.0.0.1:3306. Utilizador root sem senha (apenas desenvolvimento).
$base = if ($env:MYSQL_BASE) { $env:MYSQL_BASE } else { 'E:\mysql' }
$ligado = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($ligado) { Write-Host 'MySQL ja esta a correr em 127.0.0.1:3306.'; exit 0 }
Start-Process -FilePath "$base\bin\mysqld.exe" -ArgumentList "--defaults-file=$base\my.ini" -WindowStyle Hidden
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue) {
        Write-Host 'MySQL a correr em 127.0.0.1:3306.'; exit 0
    }
}
Write-Error "O MySQL nao arrancou. Veja $base\data\mysqld.err"; exit 1
