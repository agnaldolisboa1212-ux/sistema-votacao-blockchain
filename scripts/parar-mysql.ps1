# Para o MySQL portatil de forma limpa.
$base = if ($env:MYSQL_BASE) { $env:MYSQL_BASE } else { 'E:\mysql' }
& "$base\bin\mysqladmin.exe" -u root --host=127.0.0.1 --port=3306 shutdown
