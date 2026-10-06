import sqlite3

con = sqlite3.connect('kng-inventory/server/data/kng.db')
cur = con.cursor()

sqls = [
    "ALTER TABLE logistics_inbound ADD COLUMN freight_type TEXT DEFAULT '상차도'",
    "ALTER TABLE logistics_inbound ADD COLUMN freight_region TEXT DEFAULT ''",
    "ALTER TABLE logistics_outbound ADD COLUMN freight_type TEXT DEFAULT '상차도'",
    "ALTER TABLE logistics_outbound ADD COLUMN freight_region TEXT DEFAULT ''",
    "ALTER TABLE logistics_unit_prices ADD COLUMN is_freight_included INTEGER DEFAULT 0",
    "ALTER TABLE logistics_unit_prices ADD COLUMN price_type TEXT DEFAULT '견적가'",
    "ALTER TABLE logistics_unit_prices ADD COLUMN exchange_rate REAL DEFAULT 1.0",
    "ALTER TABLE logistics_unit_prices ADD COLUMN foreign_buy_price REAL DEFAULT 0",
    "ALTER TABLE logistics_unit_prices ADD COLUMN foreign_sell_price REAL DEFAULT 0",
    "ALTER TABLE logistics_unit_prices ADD COLUMN freight_type TEXT DEFAULT '상차도'",
    "ALTER TABLE logistics_unit_prices ADD COLUMN freight_region TEXT DEFAULT ''"
]

for s in sqls:
    try:
        cur.execute(s)
        print('SUCCESS:', s)
    except Exception as e:
        print('SKIP/ERR:', s, e)

con.commit()
con.close()
print("Migration completed.")
