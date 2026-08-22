; case gc-019-selfcycle
; expect exit=0 stdout="1\n0\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  DUP
  DUP
  ARR_PUSH
  STORE_LOCAL 0
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_LOCAL 0
  GCLIVE
  PRINT
  RET
.end
