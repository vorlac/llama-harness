; case locals-004-storepops
; expect exit=0 stdout="9\n"
.func main arity=0 locals=1
  PUSH_INT 9
  PUSH_INT 8
  STORE_LOCAL 0
  PRINT
  RET
.end
