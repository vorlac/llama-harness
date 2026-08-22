# ledger

A double-entry ledger and reconciliation engine for a small multi-currency
book of accounts.

## What it does

1. `ledger.parser` reads three CSV inputs: the transaction journal, the
   published FX rates, and a bank statement.
2. `ledger.fx` converts every transaction into the ledger's base currency
   using the rate in force on the transaction date.
3. `ledger.journal` expands each transaction into balanced postings: the
   source account is credited with the whole amount and each destination
   account is debited with its share, where the shares are produced by
   `ledger.allocation`.
4. `ledger.balances` aggregates postings per account, either over the whole
   journal or over a reporting period from `ledger.periods`.
5. `ledger.reconcile` matches a period of postings against a bank statement
   and reports the exceptions.
6. `ledger.cli` prints the balance report and the reconciliation.

Money is carried everywhere as integer minor units (cents for USD, EUR, GBP and
CHF; whole yen for JPY) alongside the currency code it belongs to.

## Data format

`data/transactions.csv`

```
date,reference,description,currency,amount,source,targets
2024-01-02,TX-0003,Utilities,USD,714.43,assets:checking,expenses:utilities
2024-01-03,TX-0007,Team meal,USD,136.68,assets:checking,expenses:meals:alice|expenses:meals:bob
2024-01-09,TX-0022,Shared cost,USD,2410.00,assets:checking,expenses:office@3|expenses:travel@1
```

`targets` is a pipe-separated list of destination accounts. A destination may
carry a relative weight after `@`; the weight defaults to 1, so a bare list is
an even split.

`data/rates.csv` holds `date,base,quote,rate` quotes, each effective from its
date until a newer quote replaces it.

`data/statement-2024-01.csv` is a bank statement for one account. The account
and currency are declared in a commented header above the CSV body.

## Running it

```sh
bash build.sh              # syntax check and import check
bash run.sh                # report over data/
bash run.sh path/to/data   # report over another data directory
bash test.sh               # run the test suite
```

Useful flags: `--base USD`, `--from-month 2024-01`, `--months 3`,
`--statement statement-2024-01.csv`, `--tolerance 0`.

## Layout

```
ledger/
  money.py       integer minor units, parsing and formatting
  periods.py     half-open reporting periods
  allocation.py  splitting an amount across weighted destinations
  fx.py          published rates and currency conversion
  model.py       Transaction, JournalEntry, Statement record types
  parser.py      CSV readers for the three inputs
  journal.py     transactions -> postings
  balances.py    postings -> per-account and per-period balances
  reconcile.py   postings vs bank statement
  cli.py         argument parsing and report rendering
tests/           unittest suite
data/            sample inputs
BUGS.md          the open field reports against this version
```

## Requirements

Python 3.9 or newer. Nothing else: the package and its suite use only the
standard library.
