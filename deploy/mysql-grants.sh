#!/bin/sh
# Runs once when the MySQL volume is created: lets the app user create and use
# one database per company (erp_<slug>).
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "GRANT ALL PRIVILEGES ON \`erp\\_%\`.* TO '$MYSQL_USER'@'%'; FLUSH PRIVILEGES;"
