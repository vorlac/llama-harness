; case locals-002-storeload
; expect exit=0 stdout="7\nseven\n"
.func main arity=0 locals=2
  PUSH_INT 7
  STORE_LOCAL 0
  PUSH_STR "seven"
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 1
  PRINT
  RET
.end
