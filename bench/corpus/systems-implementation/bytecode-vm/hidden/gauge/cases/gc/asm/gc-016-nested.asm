; case gc-016-nested
; expect exit=0 stdout="3\n0\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  NEW_ARRAY 0
  NEW_ARRAY 2
  STORE_LOCAL 0
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_LOCAL 0
  GCLIVE
  PRINT
  RET
.end
