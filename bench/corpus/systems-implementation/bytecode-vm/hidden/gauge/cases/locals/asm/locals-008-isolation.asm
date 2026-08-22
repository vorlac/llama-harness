; case locals-008-isolation
; expect exit=0 stdout="1\n"
.func main arity=0 locals=1
  PUSH_INT 1
  STORE_LOCAL 0
  CLOSURE clobber
  CALL 0
  POP
  LOAD_LOCAL 0
  PRINT
  RET
.end
.func clobber arity=0 locals=1
  PUSH_INT 99
  STORE_LOCAL 0
  PUSH_NIL
  RET
.end
