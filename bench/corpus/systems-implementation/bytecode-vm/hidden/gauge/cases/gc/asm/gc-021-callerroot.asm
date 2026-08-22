; case gc-021-callerroot
; expect exit=0 stdout="2\n[1, 2, 3]\n"
.func main arity=0 locals=1
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  NEW_ARRAY 3
  STORE_LOCAL 0
  CLOSURE probe
  CALL 0
  PRINT
  LOAD_LOCAL 0
  PRINT
  RET
.end
.func probe arity=0 locals=0
  GCLIVE
  RET
.end
