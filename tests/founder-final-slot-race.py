"""Two-connection Founder final-slot test on an explicitly disposable database.

Set FOUNDER_TEST_DISPOSABLE=yes and FOUNDER_TEST_DSN to the local test DSN;
install psycopg in a disposable venv. Never point this script at production.
"""
import os
import threading
import uuid

import psycopg

if os.getenv("FOUNDER_TEST_DISPOSABLE") != "yes" or not os.getenv("FOUNDER_TEST_DSN"):
    raise SystemExit("Explicit disposable database DSN and FOUNDER_TEST_DISPOSABLE=yes required")
DSN = os.environ["FOUNDER_TEST_DSN"]
if "host=/opt/data/cache/scratch" not in DSN:
    raise SystemExit("This test only accepts the local disposable PostgreSQL socket")

companies = [uuid.uuid4(), uuid.uuid4()]
users = [uuid.uuid4(), uuid.uuid4()]
keys = [f"race-{uuid.uuid4()}" for _ in companies]
with psycopg.connect(DSN) as conn:
    with conn.cursor() as cur:
        for user, company in zip(users, companies):
            cur.execute("insert into auth.users(id,email) values (%s,%s)", (user, f"{user}@example.invalid"))
            cur.execute("""insert into public.company_accounts
                (id,owner_user_id,stripe_customer_id,has_ever_paid_recurring,trial_started_at,trial_ends_at)
                values (%s,%s,%s,false,now()-interval '1 day',now()+interval '13 days')""",
                (company, user, f"cus-{company}"))

barrier = threading.Barrier(2)
results = []
errors = []

def begin(company, key, hold_lock):
    try:
        with psycopg.connect(DSN) as conn:
            with conn.cursor() as cur:
                barrier.wait()
                cur.execute("select allowed from public.begin_stripe_checkout_v2(%s,%s,%s,%s,%s)",
                            (company, "price-f", key, True, 1))
                results.append(cur.fetchone()[0])
                if hold_lock:
                    cur.execute("select pg_sleep(0.4)")
    except Exception as error:
        errors.append(str(error))

try:
    threads = [threading.Thread(target=begin, args=(companies[i], keys[i], i == 0)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    with psycopg.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("""select count(*) from public.stripe_checkout_attempts
                where company_account_id=any(%s::uuid[]) and founder_reserved and status='pending'""", (companies,))
            reserved = cur.fetchone()[0]
    print({"allowed": sorted(results), "errors": errors, "reserved": reserved})
    assert sorted(results) == [False, True] and reserved == 1 and not errors
finally:
    with psycopg.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("delete from public.company_accounts where id=any(%s::uuid[])", (companies,))
            cur.execute("delete from auth.users where id=any(%s::uuid[])", (users,))
