; case display-027-tostrlen
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR ""
  TOSTR
  LEN
  PRINT
  RET
.end
