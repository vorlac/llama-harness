; case gc-015-global
; expect exit=0 stdout="1\n0\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  STORE_GLOBAL g
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_GLOBAL g
  GCLIVE
  PRINT
  RET
.end
